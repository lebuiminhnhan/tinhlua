/**
 * OCB Farm — barrel export của mọi thứ liên quan tới command handler.
 *
 * `farm-command.service.ts` chỉ import từ đây (không import trực tiếp
 * `command-registry.ts`/`types.ts`), để các task 5.2-5.6 có thể thêm file
 * mới trong thư mục `commands/` mà không phải sửa import ở nơi gọi.
 *
 * _Requirements: US-21, US-29, US-40, BR-9, BR-12, BR-27_
 */

export * from './types';
export * from './command-registry';
