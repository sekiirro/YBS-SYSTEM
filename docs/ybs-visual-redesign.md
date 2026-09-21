# YBS visual redesign — implementation and review notes

## Status

System-wide implementation pass, not final visual sign-off. The supplied screenshots were used as the current-state reference. The redesigned application has not yet been reliably inspected in a rendered browser at desktop/mobile sizes. Build and component checks do not establish layout or interaction correctness.

No commits, pushes, database changes, migrations, service changes, permission changes, or auth-provider changes were made for this redesign. Pre-existing unrelated working-tree changes remain untouched.

## Direction

Ink/slate foundations with a mineral teal-to-blue identity. The expressive surface belongs to daily coaching, progress, and primary actions; operational data stays quieter. Programs, meals, measurements, exercises, and automation rules use dividers and grouped sections where separate cards add no information.

The Apple Design skill informed readable hierarchy, semantic colors, focus handling, compact layouts, and reduced motion. Native Apple navigation/material conventions were not copied into this web application.

Core tokens and compositions live in `src/styles/ybs-design.css`. UI body text uses Inter Variable with Noto Sans Arabic Variable fallback. Important numerals and the public hero use the supplied Inter Black. Most labels previously set to 8–11px are now 12px; utility text uses 13–14px, body text 15–16px, headings 28–44px, prominent metrics 40–64px. Dense table headings remain subordinate to their values.

Measured core contrast against the card surface: foreground 15.89:1, muted foreground 7.99:1, primary 10.38:1. Primary-action text against the solid primary token is 10.95:1. These are token-pair measurements, not an exhaustive audit of translucent/gradient/custom-color combinations.

## Fontz inspection

All nine supplied font files were inspected for naming, weight, glyph coverage, and available licensing metadata.

- Inter Black 900: selected for display/numerals; broad Latin coverage and OFL metadata, but only a heavy weight and no Arabic.
- Apple Garamond Light Italic: expressive editorial face, unsuitable for dense coaching controls; no Arabic and no clear embedded license.
- Impact: condensed display face with restrictive Microsoft licensing; not selected.
- Guesswhat Exceptional: limited decorative Arabic coverage, no digits; not selected.
- KO Aynama Sharp: Arabic/digit coverage, one weight, unclear license; not selected.
- Nofex: personal-use license, no digit coverage; not selected.
- Palestine: Arabic coverage and digits, unclear license; not selected for application UI.
- Year of the Camel Bold and ExtraBold: Arabic/Latin coverage, heavy weights only, unclear license; not selected.

Inter Variable and Noto Sans Arabic Variable are locally bundled through Fontsource. No external font request is required. The original `Fontz/Inter Black 900.otf` remains a build input and must be included if these uncommitted changes are later transferred elsewhere.

## Implementation coverage

- Client portal: dashboard hero/daily focus, simpler active-program sections, metric strip and charts, baseline reference sizing, photo dialog, forms/filter rows, nutrition targets/macros/meal ledger, exercise tracker control scale, package overview, profile fields, navigation/safe-area treatment.
- Public/auth: new landing composition, split auth shell used by login/registration/invitations/password/approval screens, consistent missing-page screen. Existing role redirects and query-string handoff remain intact.
- Staff: shared sidebar/header/page headers, compact operational-stat overview, workspace proportions, program library hierarchy, exercise ledger, package pricing, form-rule rows, notification feed, compact settings navigation.
- Forms/Team/Foods/form-rule history: one semantic table on desktop, labeled row layouts on compact screens, without duplicating controls.
- Nutrition/workout builders: progressive compact navigation below the wide multi-panel breakpoint, access to standalone settings, wrapping action bars, larger control type, container-responsive exercise fields. Autosave/write behavior is unchanged.
- Remaining client/staff screens inherit the shared typography, surfaces, controls, spacing, and table treatment; many received only the shared/mechanical typography pass, not a bespoke structural redesign.
- Shared dialogs now use Radix focus management. Shared inputs associate labels and errors. Skeleton loading and reusable retry states are available; portal forms/metrics/nutrition/exercise/package and staff notifications distinguish load failure from empty data.

## Self-critique corrections

- Removed nested macro cards and unnecessary program/exercise/rule cards.
- Corrected mobile nutrition selector sizing and formatted macro calorie output to avoid floating-point strings.
- Fixed the composition-chart headline consuming transformed rows as though they were raw metric records; single measurements now also have a headline.
- Chart deltas are neutral instead of treating every increase as success.
- Removed decorative notification pulsing and passive-stat hover movement.
- Corrected overlapping Forms/Form Rules navigation highlighting.
- Prevented the portal identity block from crowding profile/sign-out controls at narrow widths.
- Made program-library entry points and progress photos keyboard accessible.
- Removed an empty spacer from Settings and duplicated auth branding.

## Verification

- `npm run build`: passed, no compilation errors. Warnings remain for ambiguous pre-existing easing utilities, the packages service's mixed imports, and a large main JavaScript chunk.
- `node scripts/verify-design-components.mjs`: passed. Checks responsive table column labels/one set of controls, chart empty/single/multiple headline states, and core token contrast. This renders static component markup, not browser pixels.
- Focused ESLint checks pass for the new shared components, portal pages, auth/landing, sidebar/topbar, notifications, settings, exercises, rules, assessments, foods, and team.
- Full `npx eslint src --quiet` reports 31 unused-import errors. The eight Dashboard findings were also reproduced against HEAD. A complete baseline comparison of the other findings has not been performed.
- `git diff --check`: passed. No service, migration, AuthContext, or role-authority edits.

## Required before final sign-off

Inspect every real route with authenticated representative data at 320/390px, 768/1024px, and 1440/1920px. Capture new screenshots; old screenshots cannot validate the implementation. Check 200% zoom, long Arabic/Latin names, large metrics, focus order, dialog focus return, sidebar dismissal, mobile keyboard overlap, table row actions, and all three planner steps.

Exercise actual form save/submit, baseline/check-in, workout logging/history, replacement requests, and planner autosave in an appropriate test environment without altering real client data. Check loading/error/empty/success/disabled states beyond the specific components already covered. Full authenticated runtime testing, whole-product visual sign-off, and exhaustive accessibility/performance review remain outstanding.
