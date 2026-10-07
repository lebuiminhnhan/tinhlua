import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, firstValueFrom, map, of, retry, throwError, timer } from 'rxjs';
import {
  FARM_ERROR_CODES,
  FarmAchievementView,
  FarmBusinessErrorResponse,
  FarmCommandCode,
  FarmCommandPayloadMap,
  FarmCommandRequest,
  FarmCommandSuccessResponse,
  FarmConfigResponse,
  FarmErrorCode,
  FarmGreetingRequest,
  FarmGreetingResponse,
  FarmHelpRequest,
  FarmHelpResponse,
  FarmInboxClearGreetingsResult,
  FarmInboxDeleteGreetingResult,
  FarmInboxReadResult,
  FarmInboxResponse,
  FarmInitRequest,
  FarmInitResult,
  FarmJoinDateSuggestion,
  FarmLedgerPage,
  FarmLeaderboardResponse,
  FarmListPage,
  FarmMeResult,
  FarmVersionConflictResponse,
  FarmVisitResponse,
  LeaderboardMetric,
} from '../models/ocb-farm.model';

/**
 * OCB Farm — lớp gọi HTTP tới `/api/ocb-farm`.
 *
 * Trách nhiệm:
 * - Bọc các endpoint đọc (`/me`, `/config`, `/me/ledger`, ...) với kiểu trả về rõ ràng.
 * - Hàng chờ lệnh tuần tự cho `POST /commands`: mỗi lệnh chỉ được gửi khi lệnh trước
 *   đã có kết quả, và `version` được đọc NGAY LÚC GỬI (qua `getVersion`) để lệnh sau
 *   luôn mang phiên bản mới nhất mà lệnh trước vừa trả về (US-40).
 * - Sinh `idempotency_key` một lần lúc xếp hàng; mọi lần thử lại dùng lại đúng khóa đó
 *   nên server không nhân đôi hiệu lực (D6).
 * - Thử lại có backoff khi lỗi mạng / server tạm thời không khả dụng. 409 và 422 là
 *   kết quả nghiệp vụ, KHÔNG thử lại.
 *
 * _Requirements: US-21, US-40_
 */

const API_BASE = '/api/ocb-farm';

/** Số lần thử lại tối đa khi lỗi mạng (không tính lần gửi đầu). */
export const FARM_NETWORK_RETRY_COUNT = 3;
/** Độ trễ cơ sở của backoff lũy thừa: 500ms → 1s → 2s. */
export const FARM_NETWORK_RETRY_BASE_MS = 500;

/** Mã HTTP được coi là lỗi tạm thời (mạng / gateway) — được phép thử lại. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([0, 502, 503, 504]);

/** Kết quả của một lệnh sau khi qua hàng chờ — discriminated union theo `kind`. */
export type FarmCommandOutcome =
  | { kind: 'ok'; request: FarmCommandRequest; body: FarmCommandSuccessResponse }
  | { kind: 'conflict'; request: FarmCommandRequest; body: FarmVersionConflictResponse }
  | { kind: 'rejected'; request: FarmCommandRequest; body: FarmBusinessErrorResponse }
  /** Hết lượt thử lại mà vẫn lỗi mạng — server có thể chưa nhận lệnh. */
  | { kind: 'network'; request: FarmCommandRequest; status: number; message: string }
  /** Lỗi HTTP khác (401/403/500...) — không phải lỗi nghiệp vụ của nông trại. */
  | { kind: 'http'; request: FarmCommandRequest; status: number; message: string }
  /** Bị huỷ khi còn trong hàng chờ, chưa từng được gửi. */
  | { kind: 'cancelled'; request: FarmCommandRequest };

/** Một lệnh đang nằm trong hàng chờ (chưa gửi hoặc đang gửi). */
export interface FarmQueuedCommand {
  idempotency_key: string;
  command: FarmCommandCode;
  status: 'queued' | 'sending';
  enqueued_at: number;
}

interface QueueItem {
  key: string;
  command: FarmCommandCode;
  payload: FarmCommandPayloadMap[FarmCommandCode];
  getVersion: () => number;
  cancelled: boolean;
  enqueuedAt: number;
}

/** Sinh khóa chống lặp; dùng `crypto.randomUUID` khi có, dự phòng bằng chuỗi ngẫu nhiên. */
export function generateIdempotencyKey(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const rand = (): string => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}-${rand()}`;
}

/** Lỗi mạng / gateway tạm thời → được thử lại. */
export function isTransientHttpError(err: unknown): err is HttpErrorResponse {
  return err instanceof HttpErrorResponse && TRANSIENT_STATUSES.has(err.status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFarmErrorCode(value: unknown): value is FarmErrorCode {
  return typeof value === 'string' && (FARM_ERROR_CODES as readonly string[]).includes(value);
}

function isConflictBody(value: unknown): value is FarmVersionConflictResponse {
  return (
    isRecord(value) &&
    value['code'] === 'VERSION_CONFLICT' &&
    isRecord(value['state']) &&
    typeof value['version'] === 'number' &&
    typeof value['balance'] === 'number'
  );
}

function isBusinessErrorBody(value: unknown): value is FarmBusinessErrorResponse {
  return isRecord(value) && isFarmErrorCode(value['code']) && typeof value['message'] === 'string';
}

/** Lấy thông điệp dễ đọc từ lỗi HTTP bất kỳ. */
export function httpErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (isRecord(err.error) && typeof err.error['message'] === 'string') {
      return err.error['message'];
    }
    if (err.status === 0) return 'Không kết nối được tới máy chủ.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Lỗi không xác định.';
}

@Injectable({ providedIn: 'root' })
export class FarmApiService {
  private http = inject(HttpClient);

  /** Hàng chờ lệnh — phần tử đầu là lệnh đang gửi. */
  private queue: QueueItem[] = [];
  /** Chuỗi promise bảo đảm các lệnh chạy tuần tự. */
  private tail: Promise<unknown> = Promise.resolve();

  private readonly _queued = signal<FarmQueuedCommand[]>([]);
  /** Ảnh chụp hàng chờ để UI hiển thị (lệnh đang chờ / đang gửi). */
  readonly queued = this._queued.asReadonly();

  private readonly _retrying = signal(false);
  /** `true` khi lệnh đang gửi bị lỗi mạng và đang chờ thử lại. */
  readonly retrying = this._retrying.asReadonly();

  // ---------------------------------------------------------------------------
  // Endpoint đọc
  // ---------------------------------------------------------------------------

  getMe(): Observable<FarmMeResult> {
    return this.http.get<FarmMeResult>(`${API_BASE}/me`).pipe(this.retryTransient());
  }

  getConfig(): Observable<FarmConfigResponse> {
    return this.http.get<FarmConfigResponse>(`${API_BASE}/config`).pipe(this.retryTransient());
  }

  getJoinDateSuggestion(): Observable<FarmJoinDateSuggestion> {
    return this.http
      .get<FarmJoinDateSuggestion>(`${API_BASE}/me/join-date-suggestion`)
      .pipe(this.retryTransient());
  }

  initFarm(request: FarmInitRequest): Observable<FarmInitResult> {
    // Idempotent theo `user_id` ở server nên thử lại khi lỗi mạng là an toàn.
    return this.http.post<FarmInitResult>(`${API_BASE}/me/init`, request).pipe(this.retryTransient());
  }

  getLedger(page = 1, pageSize = 20): Observable<FarmLedgerPage> {
    const params = new HttpParams().set('page', String(page)).set('page_size', String(pageSize));
    return this.http.get<FarmLedgerPage>(`${API_BASE}/me/ledger`, { params }).pipe(this.retryTransient());
  }

  getAchievements(): Observable<FarmAchievementView[]> {
    return this.http
      .get<FarmAchievementView[]>(`${API_BASE}/me/achievements`)
      .pipe(this.retryTransient());
  }

  /** `GET /leaderboard?metric=...&department_id=...` (US-28). `departmentId=null` → không lọc. */
  getLeaderboard(metric: LeaderboardMetric, departmentId: number | null): Observable<FarmLeaderboardResponse> {
    let params = new HttpParams().set('metric', metric);
    if (departmentId !== null) {
      params = params.set('department_id', String(departmentId));
    }
    return this.http
      .get<FarmLeaderboardResponse>(`${API_BASE}/leaderboard`, { params })
      .pipe(this.retryTransient());
  }

  // ---------------------------------------------------------------------------
  // Ghé thăm và giúp đỡ đồng nghiệp (US-8, US-26, US-27, BR-21)
  // ---------------------------------------------------------------------------

  /**
   * `GET /farms?q=&department_id=&page=&page_size=` — danh sách nông trại để ghé thăm.
   * Container chỉ gọi khi `q` rỗng hoặc có ít nhất 2 ký tự (US-26); service không tự
   * ràng buộc độ dài để không trùng logic kiểm tra với phía gọi.
   */
  getFarms(opts: {
    q?: string;
    departmentId?: number | null;
    page?: number;
    pageSize?: number;
  }): Observable<FarmListPage> {
    let params = new HttpParams();
    if (opts.q && opts.q.trim().length > 0) params = params.set('q', opts.q.trim());
    if (opts.departmentId !== null && opts.departmentId !== undefined) {
      params = params.set('department_id', String(opts.departmentId));
    }
    if (opts.page !== undefined) params = params.set('page', String(opts.page));
    if (opts.pageSize !== undefined) params = params.set('page_size', String(opts.pageSize));
    return this.http.get<FarmListPage>(`${API_BASE}/farms`, { params }).pipe(this.retryTransient());
  }

  /** `GET /farms/:userId` — nông trại đồng nghiệp ở chế độ chỉ xem (US-26). */
  getFarmVisit(userId: number): Observable<FarmVisitResponse> {
    return this.http.get<FarmVisitResponse>(`${API_BASE}/farms/${userId}`).pipe(this.retryTransient());
  }

  /**
   * `POST /farms/:userId/help` — giúp tưới cây / cho ăn (US-27). KHÔNG thử lại lỗi mạng:
   * lượt giúp và thưởng ở cả hai phía chỉ được tính đúng một lần, lặp lại request có thể
   * trông như "chưa gửi" trong khi server đã áp dụng.
   */
  helpFarm(userId: number, request: FarmHelpRequest): Observable<FarmHelpResponse> {
    return this.http.post<FarmHelpResponse>(`${API_BASE}/farms/${userId}/help`, request);
  }

  /** `POST /farms/:userId/greeting` — gửi lời chúc (US-8, US-48). Không thử lại, lý do như trên. */
  sendGreeting(userId: number, request: FarmGreetingRequest): Observable<FarmGreetingResponse> {
    return this.http.post<FarmGreetingResponse>(`${API_BASE}/farms/${userId}/greeting`, request);
  }

  // ---------------------------------------------------------------------------
  // Hộp thư: người đã giúp + lời chúc (US-8, US-27, US-48)
  // ---------------------------------------------------------------------------

  /** `GET /me/inbox` — người đã giúp + lời chúc, kèm cờ "mới". */
  getInbox(): Observable<FarmInboxResponse> {
    return this.http.get<FarmInboxResponse>(`${API_BASE}/me/inbox`).pipe(this.retryTransient());
  }

  /** `POST /me/inbox/read` — đánh dấu đã xem toàn bộ hộp thư, xoá cờ "mới". */
  markInboxRead(): Observable<FarmInboxReadResult> {
    return this.http.post<FarmInboxReadResult>(`${API_BASE}/me/inbox/read`, {});
  }

  /** `DELETE /me/inbox/greetings/:id` — xoá một lời chúc (US-48). */
  deleteGreeting(greetingId: number): Observable<FarmInboxDeleteGreetingResult> {
    return this.http.delete<FarmInboxDeleteGreetingResult>(`${API_BASE}/me/inbox/greetings/${greetingId}`);
  }

  /** `DELETE /me/inbox/greetings` — xoá toàn bộ lời chúc (US-48). */
  clearGreetings(): Observable<FarmInboxClearGreetingsResult> {
    return this.http.delete<FarmInboxClearGreetingsResult>(`${API_BASE}/me/inbox/greetings`);
  }

  // ---------------------------------------------------------------------------
  // Hàng chờ lệnh `POST /commands`
  // ---------------------------------------------------------------------------

  /**
   * Xếp một lệnh vào hàng chờ. Promise luôn resolve (không reject) với một
   * {@link FarmCommandOutcome} để phía gọi xử lý theo `kind`.
   *
   * @param getVersion được gọi ngay trước khi gửi để lấy `version` mới nhất.
   */
  enqueue<C extends FarmCommandCode>(
    command: C,
    payload: FarmCommandPayloadMap[C],
    getVersion: () => number,
  ): { idempotencyKey: string; result: Promise<FarmCommandOutcome> } {
    const item: QueueItem = {
      key: generateIdempotencyKey(),
      command,
      payload,
      getVersion,
      cancelled: false,
      enqueuedAt: Date.now(),
    };
    this.queue.push(item);
    this.publishQueue();

    const result = this.tail.then(() => this.process(item));
    // Chuỗi tuần tự không bao giờ bị đứt vì `process` không reject.
    this.tail = result;
    return { idempotencyKey: item.key, result };
  }

  /**
   * Huỷ các lệnh CHƯA gửi trong hàng chờ (lệnh đang gửi không huỷ được).
   * Trả về các lệnh đã bị huỷ để UI nêu rõ thao tác nào không được thực hiện.
   */
  cancelQueued(): FarmQueuedCommand[] {
    const cancelled: FarmQueuedCommand[] = [];
    for (const item of this.queue) {
      if (!item.cancelled && !this.isSending(item)) {
        item.cancelled = true;
        cancelled.push(this.toView(item, 'queued'));
      }
    }
    this.publishQueue();
    return cancelled;
  }

  private async process(item: QueueItem): Promise<FarmCommandOutcome> {
    const request = this.buildRequest(item);
    if (item.cancelled) {
      this.dequeue(item);
      return { kind: 'cancelled', request };
    }

    this.publishQueue(item);
    try {
      return await firstValueFrom(this.send(request));
    } finally {
      this._retrying.set(false);
      this.dequeue(item);
    }
  }

  private send(request: FarmCommandRequest): Observable<FarmCommandOutcome> {
    return this.http.post<FarmCommandSuccessResponse>(`${API_BASE}/commands`, request).pipe(
      this.retryTransient(),
      map((body): FarmCommandOutcome => ({ kind: 'ok', request, body })),
      catchError((err: unknown) => of(this.toFailureOutcome(request, err))),
    );
  }

  private toFailureOutcome(request: FarmCommandRequest, err: unknown): FarmCommandOutcome {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 409 && isConflictBody(err.error)) {
        return { kind: 'conflict', request, body: err.error };
      }
      if (err.status === 422 && isBusinessErrorBody(err.error)) {
        return { kind: 'rejected', request, body: err.error };
      }
      if (TRANSIENT_STATUSES.has(err.status)) {
        return { kind: 'network', request, status: err.status, message: httpErrorMessage(err) };
      }
      return { kind: 'http', request, status: err.status, message: httpErrorMessage(err) };
    }
    return { kind: 'network', request, status: 0, message: httpErrorMessage(err) };
  }

  /** Thử lại với backoff lũy thừa, chỉ cho lỗi mạng / gateway tạm thời. */
  private retryTransient<T>() {
    return (source: Observable<T>): Observable<T> =>
      source.pipe(
        retry({
          count: FARM_NETWORK_RETRY_COUNT,
          delay: (err: unknown, attempt: number) => {
            if (!isTransientHttpError(err)) {
              return throwError(() => err);
            }
            this._retrying.set(true);
            return timer(FARM_NETWORK_RETRY_BASE_MS * 2 ** (attempt - 1));
          },
        }),
      );
  }

  private buildRequest(item: QueueItem): FarmCommandRequest {
    // Payload đã được ràng buộc theo `command` ở chữ ký `enqueue`, nên envelope
    // dựng ở đây luôn khớp một nhánh của union `FarmCommandRequest`.
    return {
      command: item.command,
      payload: item.payload,
      version: item.getVersion(),
      idempotency_key: item.key,
    } as FarmCommandRequest;
  }

  private sendingKey: string | null = null;

  private isSending(item: QueueItem): boolean {
    return this.sendingKey === item.key;
  }

  private dequeue(item: QueueItem): void {
    this.queue = this.queue.filter((q) => q !== item);
    if (this.sendingKey === item.key) this.sendingKey = null;
    this.publishQueue();
  }

  private publishQueue(sending?: QueueItem): void {
    if (sending) this.sendingKey = sending.key;
    this._queued.set(
      this.queue
        .filter((q) => !q.cancelled)
        .map((q) => this.toView(q, this.isSending(q) ? 'sending' : 'queued')),
    );
  }

  private toView(item: QueueItem, status: FarmQueuedCommand['status']): FarmQueuedCommand {
    return {
      idempotency_key: item.key,
      command: item.command,
      status,
      enqueued_at: item.enqueuedAt,
    };
  }
}
