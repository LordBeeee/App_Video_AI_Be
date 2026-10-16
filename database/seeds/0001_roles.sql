INSERT INTO roles (id, name, description)
VALUES
  (1, 'admin', 'Quản trị hệ thống'),
  (2, 'employee', 'Nhân viên')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('roles', 'id'), (SELECT MAX(id) FROM roles));
