
/**
 * Hệ thống quản lý phiên bản ứng dụng DYsT
 * Major: Thay đổi lớn về kiến trúc hoặc giao diện
 * Minor: Thêm tính năng mới
 * Patch: Sửa lỗi nhỏ hoặc thay đổi text
 */
export const APP_VERSION = {
  major: 1,
  minor: 0,
  patch: 11,
  
  // Getter để lấy chuỗi phiên bản đầy đủ
  get full(): string {
    return `v${this.major}.${this.minor}.${this.patch}`;
  },
  
  // Thông tin bản quyền
  copyright: 'DYsT © 2024 by Võ Văn Cảnh vs AI'
};
