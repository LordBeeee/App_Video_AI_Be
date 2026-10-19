# Database setup

## Fresh installation

Use an empty PostgreSQL database. `npm run db:setup` executes
`database/migrations/0001_fresh_install.sql`, then `database/seeds/0001_roles.sql`.
It creates the tables used by the current backend and seeds role IDs 1 and 2.
It refuses to run when a `roles` table already exists. Do not use it against
an existing installation.

`scene_id` in `assets` is retained for compatibility with the entity. The
current backend has no scenes module or scene table.

## Existing installation

The old `migrations/202610070001_ai_platform.sql` is a one-time upgrade from
the previous schema. It renames and drops legacy tables, and requires the
previous application database. **Do not run it on a fresh installation.**
Back up the database before running it. The separate
`migrations/202610160001_reference_assets.sql` updates the source-type check
for an existing installation when that file is present in the checkout.
After deploying the Element/Voice API, run
`migrations/202610190001_elements_and_voices.sql` on existing installations.
It moves Kling Element and Voice assets to `source_type = 'external'`, updates
Element metadata keys, and removes `reference` from the source-type check.
Fresh installations already use the new check constraint.

The backend uses TypeORM with `synchronize: false`; starting the app never
creates or updates tables automatically.
