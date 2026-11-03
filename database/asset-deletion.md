# Library asset deletion

For an existing database, run this from the backend directory before deploying/restarting the updated backend:

```powershell
node --env-file=.env scripts/migrate-asset-deletion.cjs
```

The migration is transactional and can be run again. Rerun it when upgrading an earlier version of this feature: schema version 2 adds canonical file identities and the failed status. Fresh installations include the schema in `0001_fresh_install.sql`.

`DELETE /assets/:id` checks ownership and active consumers, persists a job and marks the asset as deleting. It attempts Cloudinary deletion immediately, then removes output URLs and the asset in a DB transaction. Generation links cascade; billing and generation history remain. The endpoint returns `completed`, `pending`, or `failed`. Repeated requests by the same owner are safe.

The worker runs every 30 seconds. Temporary failures are retained in `asset_deletion_jobs.last_error` and retried with exponential backoff from 60 seconds to one hour. Cloudinary HTTP 400/401/403/404 errors stop automatic retries and mark the asset failed; after fixing configuration, an explicit DELETE retries the same durable job. Missing schema is reported once with migration instructions, and deletion returns HTTP 503 until the schema is ready. Cloudinary deletion accepts `not found`, so a DB failure after cloud deletion can recover. Completed jobs remain as an audit/idempotency record; the media's `assets` row is physically deleted.

Database triggers serialize new generation/custom-asset references with deletion. Assets used by running generations, other assets (including Element/Voice sources), or a project/scene are rejected with HTTP 409. Shared assets must be detached before deletion. Legacy Cloudinary URLs are resolved on demand; unsupported URLs are rejected rather than guessing a file identifier.

Deployment verification: delete an image, video and audio in a test account; confirm the `assets` row, generation output URL and Cloudinary resource are gone. Test a source used by Element/Voice (409), cancellation of confirmation, and a temporary Cloudinary outage (pending, then automatically completed). CDN invalidation is asynchronous.


Regression verification (no production database or Cloudinary writes):

```powershell
npm run build
npm test -- --runInBand
# Optional PostgreSQL WASM runtime, installed only under the ignored .tmp directory:
npm install --prefix .tmp/asset-deletion-pg --no-save --package-lock=false @electric-sql/pglite
$env:ASSET_DELETION_PG_MODULE = (Resolve-Path .tmp/asset-deletion-pg/node_modules/@electric-sql/pglite).Path
node test/asset-deletion.postgres.cjs
```

The PostgreSQL checks cover fresh/repeat migration, normalized identities, active/deleted dependencies, trigger rejection, cascade and output cleanup, transient retry, permanent failure recovery and ownership. The harness uses the production service and its SQL with a thin database adapter; only Cloudinary responses are stubbed. The unsupported `pgcrypto` extension declaration is omitted in WASM (its built-in UUID generator is available). WASM is single-session: simultaneous requests across separate PostgreSQL connections still require a disposable PostgreSQL server test before a production rollout.
