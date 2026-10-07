import { seniorityFromMonths, slugifyFarmName, snapshotCaption, snapshotFileName } from './snapshot';

describe('snapshot helpers', () => {
  it('slugifies Vietnamese farm names', () => {
    expect(slugifyFarmName('Nông trại Đồng Xanh')).toBe('nong-trai-dong-xanh');
    expect(slugifyFarmName('  !!! ')).toBe('nong-trai');
  });

  it('builds file name with farm name and VN capture date (UTC+7)', () => {
    // 2025-03-10 18:30 UTC = 2025-03-11 01:30 giờ Việt Nam.
    const now = Date.UTC(2025, 2, 10, 18, 30);
    expect(snapshotFileName('Vườn Mai', now)).toBe('ocb-farm-vuon-mai-2025-03-11.png');
  });

  it('captions own farm with owner name and seniority', () => {
    const c = snapshotCaption({
      farmName: 'Vườn Mai',
      ownerName: 'Nguyễn Văn A',
      seniority: { years: 3, months: 2 },
      visiting: false,
      nowMs: Date.UTC(2025, 2, 10, 3),
    });
    expect(c.badge).toBeNull();
    expect(c.title).toBe('Vườn Mai');
    expect(c.subtitle).toBe('Nguyễn Văn A · Thâm niên: 3 năm 2 tháng');
    expect(c.footer).toContain('10/03/2025');
  });

  it('labels visit mode as a colleague farm', () => {
    const c = snapshotCaption({ farmName: 'Trại B', ownerName: 'Trần B', seniority: seniorityFromMonths(14), visiting: true });
    expect(c.badge).toBe('Nông trại của đồng nghiệp Trần B');
    expect(c.subtitle).toContain('Chủ nông trại: Trần B');
    expect(c.subtitle).toContain('1 năm 2 tháng');
  });
});
