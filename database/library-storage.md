# Library storage quota

Each user's uploaded and generated files share 500,000,000 bytes (500 decimal MB).
The implementation reuses `assets.file_size_bytes`, `AssetsService`, existing
generation output persistence, and the durable Cloudinary deletion worker.
No additional schema migration or quota counter is required.

`GET /assets/storage-usage` returns the authenticated user's `usedBytes`,
`limitBytes`, `remainingBytes`, `unknownSizeCount`, and `blocked` flag.
Files are deduplicated by Cloudinary resource/delivery/public ID where possible,
or exact stored URL otherwise. Provider Element/Voice references do not count
again. Separate auxiliary files (such as last frames) count. This measures
library files, not Cloudinary bandwidth, transformation storage, or orphan files.

Admission policy:

- Uploads must fit the remaining space. Concurrent uploads for one user are
  serialized with a PostgreSQL session advisory lock; a competing upload returns
  HTTP 409 and can be retried. Connections/locks are released on failure.
- New image/audio/video generation checks quota before wallet holds, consuming
  the quote, persisting a generation, or invoking a generation provider.
- No estimated space is reserved for AI jobs. All previously admitted jobs may
  finish and save their outputs, even above quota. For example, 480 MB plus a
  30 MB video becomes 510 MB; subsequent uploads and generation return HTTP 403
  (`LIBRARY_STORAGE_LIMIT_EXCEEDED`). Multiple admitted jobs may exceed 500 MB
  by more than one output. Generation history and billing are preserved.
- Files pending deletion, or whose deletion failed, still count. Once the
  existing deletion worker removes the asset row, capacity is available again.
  Library UI refreshes usage after uploads/deletions, on focus and every 15 seconds.
  Viewing, downloading, and deleting remain available while over quota.
- Legacy missing sizes are read from Cloudinary metadata and persisted when
  usage is checked. Unresolved sizes are reported, and admission returns HTTP 503
  (`LIBRARY_STORAGE_USAGE_UNAVAILABLE`) rather than treating unknown bytes as
  free. Check provider access and legacy resource identities if this persists.

Validation: `npm run build`, `npm test -- --runInBand` in the backend and
`npm run build` in the frontend. Live rollout should verify a disposable account
at 480 MB admitting a video, completion above 500 MB, rejection of new work
without charging, and reopening capacity after actual deletion.
