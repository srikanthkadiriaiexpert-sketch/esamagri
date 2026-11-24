# features/pif

PIF (Payment Issue Facility) screens, components, hooks, and API client code
live here. Populated starting in a later Phase 3B/3C stage — empty for
now (STEP 3 only establishes the folder boundary).

Rule carried over from the backend module boundary (apps/api's
RikModule/PifModule never import each other): code under `features/pif`
must never import from `features/rik`. Shared UI/logic goes in
`features/shared` instead.
