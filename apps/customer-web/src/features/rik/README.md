# features/rik

RIK (Ration in Kind) screens, components, hooks, and API client code live
here. Populated starting in a later Phase 3B/3C stage — empty for now
(STEP 3 only establishes the folder boundary).

Rule carried over from the backend module boundary (apps/api's
RikModule/PifModule never import each other): code under `features/rik`
must never import from `features/pif`. Shared UI/logic goes in
`features/shared` instead. The customer-facing RIK/PIF toggle is a
convenience only — it is not a security boundary, and neither is this
folder split; real enforcement is server-side.
