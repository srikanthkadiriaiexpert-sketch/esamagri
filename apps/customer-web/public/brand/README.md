# Brand assets

`e-samagri-logo.jpg` is the **final, approved e Samagri logo** supplied by
the client, used here byte-for-byte unmodified. It is never cropped,
redrawn, recolored, or reinterpreted anywhere in this app.

(An earlier logo version was supplied and used briefly during STEP 8 before
being superseded by this final version — every file that referenced the
earlier asset was reverted before this one was introduced. This is the only
logo file that should ever exist in this repository.)

The only mechanical operation applied anywhere in this codebase is fitting
the unaltered image onto a plain white square canvas (uniform scale + center,
no cropping of the artwork) to satisfy platform icon-slot requirements
(`public/icons/*.png` — PWA/home-screen/favicon icons). That step does not
change the artwork itself, only where it sits on a blank square.

Tailwind's `brand.*` color tokens (see `tailwind.config.js`) were sampled
programmatically from this image's and the approved UI reference's colors —
the deep forest wordmark color, the logo's green, and the blue used for RIK
throughout the approved UI reference — reusing real approved colors as UI
tokens, not inventing a new palette.

The tagline baked into this logo graphic — **"Essentials for a Brighter
Tomorrow"** — is used as the app's short tagline (page `<title>`/meta
description, PWA manifest), and the fuller **"Everyday Essentials for a
Brighter Tomorrow"** headline from the approved UI reference is used as the
live home-screen hero heading — both supersede the earlier "Essential
Services. Made Simple." text used before this final logo/UI reference was
supplied.
