# Design system and review bar

Status: target design guidance. Existing CSS/components are not all compliant; this document does not claim a visual audit passed.

## 1. Principles

1. **Clarity before minimal decoration.** Give necessary context and labels. Hiding navigation to make a page look empty is not simplicity.
2. **Calm hierarchy.** Strong typography, restrained BMT branding, neutral light surfaces, deliberate spacing. One main task per destination; urgent state gets attention only when applicable.
3. **Predictable interaction.** Familiar links, forms, dialogs and search. No discovery-dependent gestures or hover-only information.
4. **Immediate, honest feedback.** Press feedback is instant; saved/published/sent are different outcomes. Preserve drafts on failure and tell the user what to do next.
5. **Accessible by default.** Design for sunlight, small/older devices, large text, keyboard and assistive technology. Color never carries meaning alone.
6. **Berkeley public identity; Lemon staff identity.** Per Ian's October 21 direction, match [berkeley.mt](https://berkeley.mt/)'s public appearance as closely as practical: its logo, IBM Plex typography, light neutral background, restrained links, centered content and editorial rhythm. Adapt navigation to tournament-day tasks rather than copying marketing content. Staff navigation, control conventions and account footer should feel familiar with Lemon, without shared sessions.

## 2. Reference skills

Public reference: [berkeley.mt at 769770a](https://github.com/berkeleymt/berkeley.mt/tree/769770aa0d0a5398ea15183e118905bf1adc8300). Its Markdown/TOML-frontmatter, shared templates and shortcodes inform the proposed content migration; replacing Live's runtime with Zola is **not approved**. See the [direction and migration proposal](status/log/2026-10-21-content-driven-direction.md).

Reviewed Lemon's packaged [Apple design guidance](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/apple-design.skill), [animation guidance](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/animate.skill), [design skill](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/design-skill.md) and [design system](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/design-system.md). The `.skill` files are ZIP packages containing `SKILL.md`; read their contents, not the binary as text.

Apply their purpose, feedback, restraint, readable hierarchy and reduced-motion principles. Do not transplant glass effects, drag interactions or Lemon-specific table constraints just to resemble Apple/Lemon. Legibility and older-device performance take precedence over translucency. This docs pass implements no animation.

## 3. Typography, spacing and controls

- Use the current bundled IBM Plex Sans/system fallback as the initial prototype baseline; change only with a readable comparison. Do not add runtime font-CDN dependence.
- Target comfortable 16–18px-equivalent public body/input text, relative units and a generous line height. This is a starting scale, not a hard pixel lock; browser text size and zoom must work.
- Establish shared tokens for type, spacing, borders, colors, focus, status and motion when implementing. Avoid a separate ad-hoc scale on every feature page.
- Use text + optional consistent icons for navigation; an icon-only button needs an accessible name and genuinely familiar meaning. No emoji as the icon system.
- Aim for 44px-or-larger touch targets with separation. No small tap targets just because a dense desktop staff table uses them.
- Ordinary links look actionable. Primary buttons name the result: Find my rooms, Submit report, Publish update, not generic Continue everywhere.
- All controls have focus, pressed, disabled-with-reason, busy and error states without changing their size. Invalid forms preserve entered content.
- No giant empty hero, decorative statistics, auto-rotating carousel, gradient-heavy card wall, parallax or marketing section between a visitor and their information.

## 4. Motion

Gate motion by purpose: feedback, spatial context or a meaningful state transition. Reading data must not move for style. High-frequency navigation and keyboard actions should be immediate. Use CSS for simple feedback; use an existing motion library only for a justified interruptible transition.

Use named shared tokens and the reference skill's timing/curves rather than arbitrary values. A starting UI range is 100–250ms, generally under 300ms; no decorative bounce. Prefer transform/opacity; do not animate layout repeatedly during schedule refresh. Do not lock input during transitions. Respect reduced motion, high contrast and reduced transparency; hover effects apply only to appropriate pointer devices. Gesture enhancement must have a normal button alternative.

## 5. Accessibility and compatibility acceptance

Target WCAG 2.2 AA, not an unverified compliance claim. Verify:

- Semantic heading order, landmarks, skip link, current-page indication, form labels and clear errors.
- Text contrast at least 4.5:1 for normal text, 3:1 for large text; meaningful control/focus boundaries visible.
- Keyboard completion of all journeys; focus restored after dialogs; no focus traps outside modal dialogs.
- 200% text zoom and narrow reflow equivalent to 320 CSS px without losing controls/content. Map/table internal scrolling must not make the entire page scroll sideways.
- Screen-reader labels and restrained live announcements; maps have equivalent searchable text and directions.
- No device-only assumption: iOS Safari, Android Chrome, desktop Safari/Chrome/Firefox/Edge; include an older iPhone and a lower-end Android device when selecting real test hardware.
- Feature detection/fallback for newer browser APIs. Current use of `AbortSignal.any`/`timeout` needs a supported-browser audit rather than assuming it works on every older phone.
- RTL, longer translated text, no clipped buttons, language metadata and source-English fallback.

## 6. Review checklist

- [ ] Page answers where am I, what can I do, where is Help, how do I go back?
- [ ] Visitor can reach every primary destination from Home without hunting.
- [ ] Loading, empty, stale, offline, error, success and missing-data states are intentionally designed.
- [ ] No scroll/focus jump when schedule or notices update.
- [ ] Public UI does not expose staff-only imports, contact data, drafts or account details.
- [ ] Mobile portrait/landscape, tablet, desktop, keyboard, zoom and reduced motion checked.
- [ ] No hover/animation required to understand information or complete a task.
- [ ] Actual users can complete the core journeys without explanation; findings recorded.

Unchecked boxes are work, not evidence of failure or success. See [testing](testing.md) for how results are recorded.
