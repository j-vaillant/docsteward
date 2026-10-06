---
name: DocSteward
description: A contemporary bookbinding workbench for calm, local document stewardship.
colors:
  paper: '#fffefa'
  canvas: '#f3efe6'
  ink: '#1d211f'
  muted-ink: '#686b66'
  binding-rule: '#d8d1c3'
  binding-rule-soft: '#e9e3d8'
  annotation-blue: '#1d4ed8'
  annotation-blue-soft: '#e7edff'
  safe-green: '#27794c'
  safe-green-soft: '#e8f3ec'
  conflict-red: '#a43a32'
  conflict-red-soft: '#f9e9e6'
  brand-navy: '#233b64'
  focus-blue: '#9bb4ff'
typography:
  display:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: '48px'
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: '-0.035em'
  headline:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: '29px'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  title:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: '16px'
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.6
  preview-code:
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.72
  preview-editorial:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: '18px'
    fontWeight: 400
    lineHeight: 1.78
  label:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '11px'
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: '0.09em'
rounded:
  paper-edge: '3px 9px 9px 3px'
  folio-edge: '4px 12px 12px 4px'
  compact: '7px'
  notice: '8px'
  control: '9px'
  panel: '14px'
  brand: '15px'
  round: '50%'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '22px'
  xxl: '28px'
  editor-inline: 'clamp(36px, 7vw, 96px)'
components:
  button-primary:
    backgroundColor: '{colors.annotation-blue}'
    textColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: '0 17px'
    height: '42px'
  button-primary-hover:
    backgroundColor: '#1742ba'
    textColor: '{colors.paper}'
  button-primary-disabled:
    backgroundColor: '#aeb5c8'
    textColor: '{colors.paper}'
  button-secondary:
    backgroundColor: 'rgba(255, 255, 255, 0.55)'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '0 17px'
    height: '42px'
  registry-item-selected:
    backgroundColor: '#dfe7fb'
    textColor: '#153caa'
    rounded: '{rounded.compact}'
    padding: '5px 9px'
    height: '34px'
  workspace-select:
    backgroundColor: 'rgba(255, 255, 255, 0.7)'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '0 34px 0 12px'
    height: '42px'
  text-preview:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    typography: '{typography.preview-code}'
    padding: '46px clamp(36px, 7vw, 96px) 80px'
  notice-success:
    backgroundColor: '{colors.safe-green-soft}'
    textColor: '#1c603b'
    rounded: '{rounded.notice}'
    padding: '10px 13px'
  notice-error:
    backgroundColor: '{colors.conflict-red-soft}'
    textColor: '#7c2924'
    rounded: '{rounded.notice}'
    padding: '10px 13px'
---

# Design System: DocSteward

## Overview

**Creative North Star: "The Working Colophon"**

DocSteward is a contemporary bookbinding and colophon library: warm paper, dark ink, fine rules, and carefully placed annotations make local document consultation feel tended rather than administered. The interface is compact and editorial, but never precious. Its hierarchy serves the document first and makes read-only privacy legible at the margin.

The desktop composition behaves like an open volume with reference apparatus around it: a registry at left, the dominant document or inquiry surface in the center, and an information colophon at right. The opt-in questions-and-indicators view is another reading mode within that hierarchy, not a dashboard detached from the library. Blue is the librarian's pencil; green and red report verified system states. Controls remain recognizably desktop-native, while serif display moments and asymmetric paper silhouettes carry the identity.

**Key Characteristics:**

- Warm paper and canvas surfaces separated by hairline binding rules.
- A three-part registry, document, and security-margin composition.
- Georgia for editorial voice; Inter and system sans for operation; system mono for code-like text.
- Annotation blue used sparingly for actions, selection, focus, active tabs, and loading state.
- Opt-in document inquiry presented as cited reading, with privacy disclosure kept adjacent to the activity.
- Compact behavior preserves the active reading or inquiry surface before secondary metadata.

## Colors

The palette is a warm neutral paper field with one decisive annotation blue and restrained semantic inks.

### Primary

- **Annotation Blue** (`annotation-blue`): primary action, selected registry row, active spreadsheet tab, preview focus edge, and loading progress.
- **Washed Annotation Blue** (`annotation-blue-soft`): low-intensity informational feedback.

### Secondary

- **Safe Green Ink** (`safe-green`): server readiness, local-processing assurance, and verified read-only state.
- **Conflict Red Ink** (`conflict-red`): failures and conflict conditions that need attention.
- Their soft companions are reserved for semantic message fields, not decoration.

### Neutral

- **Fresh Paper** (`paper`): the document leaf and clean content surfaces.
- **Book Cloth Canvas** (`canvas`): the surrounding shell, registry, welcome, and startup fields.
- **Printer's Ink** (`ink`): primary text.
- **Pencil Graphite** (`muted-ink`): metadata and explanatory copy.
- **Binding Rule** and **Soft Binding Rule** (`binding-rule`, `binding-rule-soft`): structural dividers, outlines, and quiet hierarchy.
- **Binder's Navy** (`brand-navy`): the book mark and brand icon, never a second general-purpose accent.

**The Annotator's Pencil Rule.** Blue marks what can be acted on, selected, focused, or actively viewed; it does not wash entire regions for atmosphere.

**The Semantic Ink Rule.** Green and red appear only when they communicate system truth.

### Brand Mark

The DocSteward mark combines two open document leaves with the restrained lift of aircraft wings. The left leaf and central binding use Binder's Navy; the right leaf uses Annotation Blue. This asymmetry connects stewardship to action without turning the product into an airline identity. Use the mark on paper or canvas surfaces with generous clear space. At small interface sizes, pair it with the DocSteward wordmark and never recolor its individual parts.

## Typography

**Display Font:** Georgia (with Times New Roman and serif fallbacks)  
**Body Font:** Inter (with platform UI sans-serif fallbacks)  
**Label/Mono Font:** SFMono-Regular (with Consolas, Liberation Mono, and monospace fallbacks)

**Character:** The serif face makes headings and extracted documents feel printed and composed. The sans face keeps controls and metadata direct, while the monospace preview makes plain text and code structurally honest.

### Hierarchy

- **Display** (600, 48px, 1.05): the welcome promise only; tightly set and centered.
- **Headline** (600, 29px, 1.2): empty-state and document-opening prompts.
- **Title** (600, 16px, 1.3): small editorial headings in the inspector.
- **Body** (400, 13px, 1.6): interface copy, metadata, notices, and operational guidance.
- **Preview Code** (400, 15px, 1.72): read-only plain-text and code previews with a two-space tab rhythm.
- **Preview Editorial** (400, 18px, 1.78): extracted Word content and editorial reading surfaces in Georgia.
- **Label** (750, 11px, 0.09em, uppercase): registry and inspector section labels.

**The Two-Voices Rule.** Serif carries document culture; sans carries interface operation. Do not set dense controls or file trees in serif.

## Layout

The full library is a fixed-height, three-column grid: a 270px registry, a flexible preview with a 480px minimum, and a 300px information margin. The center is visually and spatially dominant. The registry and inspector are tonal side fields divided from the preview by single-pixel rules; both may scroll independently. A 48px horizontal action row sits above the main surface, and the active document preview occupies the remaining height below its own 58px toolbar.

Text and Word previews use generous responsive insets (`editor-inline`) rather than a floating card. PDF and spreadsheet previews may use the full center surface. The toolbar and notices use tighter operational spacing, while sidebar groups are separated by rules and 18–28px intervals. Nested registry rows indent in 15px steps.

The document is the implicit default and never appears as a navigation entry. The file registry remains visible while the horizontal Questions and Indicators tabs replace the preview with a single scrolling paper field. Selecting a file naturally returns to its document preview. Inquiry, answer, sources, pinning, and saved indicators form vertical reading sequences rather than a set of floating dashboard cards. Indicator tiles use a two-column ruled grid at full width; a single tile spans both columns so it reads as an intentional record rather than half an empty dashboard.

AI access is supplied by the authenticated DocSteward account; there is no device-level model or credential configuration in the interface. Workspace consent and indexing remain in the Configuration tab. The bottom-left of the registry holds the account avatar, whose upward-opening profile menu identifies the current user and provides logout.

At 1120px and below, the layout becomes a 245px registry plus a document or inquiry surface with a 460px minimum. The inspector is removed completely and registry padding tightens. In the questions view, the OpenAI transmission disclosure moves into the hero before the inspector disappears, and indicator tiles collapse to one column. At 760px and below, inquiry rows and answer fields stack and primary actions take the available width.

**The Document Wins Rule.** When width is constrained, metadata yields before the registry and active reading surface; the document or inquiry remains dominant.

## Elevation & Depth

The system is flat and paper-led. Tonal layering and hairline rules establish most depth. Shadows are ambient and limited to book-like artifacts, the brand mark, and the primary action; operational panels do not float.

### Shadow Vocabulary

- **Bound Folio** (`10px 12px 30px rgba(66, 52, 31, 0.1)`): the welcome-page book silhouette.
- **Paper Leaf** (`6px 8px 20px rgba(50, 40, 25, 0.08)`): the empty preview's page cue.
- **Brand Seal** (`0 12px 28px rgba(35, 59, 100, 0.22)`): the startup book mark.
- **Action Lift** (`0 5px 16px rgba(29, 78, 216, 0.2)`): the enabled primary button only.

**The Bound-Not-Floating Rule.** Use rules and surface tone for application structure; reserve shadow for physical paper cues and the singular primary action.

## Shapes

Corners are restrained and tactile. Controls use gently rounded 9px corners, compact rows and code blocks use 7px, and notices use 8px. Book and paper motifs use asymmetric radii—tighter at the spine, softer at the fore-edge—plus an inset vertical binding line. Circles are reserved for status lights and verification checks.

Thin one-pixel borders should look like binding rules, not container decoration. Avoid nested rounded cards: most content is held by alignment, whitespace, and rules.

## Components

### Buttons

- **Shape:** tactile desktop controls with a 42px minimum height and 9px radius.
- **Primary:** annotation blue, white type, medium-heavy weight, and a small ambient action shadow.
- **Hover / Focus:** darkens to a deeper blue and lifts by one pixel over 160ms; focus uses a 3px pale-blue outline with a 2px offset. Active returns to the baseline.
- **Disabled:** cool gray, no shadow, and a not-allowed cursor.
- **Secondary:** translucent paper with a warm gray border; hover becomes opaque paper with a darker border.

### Cards / Containers

- **Corner Style:** containers are usually square fields separated by rules; only semantic notices and paper artifacts are rounded.
- **Background:** warm canvas for the registry, fresh paper for text and Word previews, and an off-paper tint for the information margin.
- **Shadow Strategy:** none for structural containers; see the limited artifact shadows above.
- **Border:** one-pixel warm rules.
- **Internal Padding:** 18–28px for side fields and toolbar regions; reading previews use the larger responsive inset.

### Inputs / Fields

- **Workspace Select:** translucent white, warm border, 9px corners, 42px height, and strong sans text.
- **Text Preview:** borderless fresh paper with selectable, read-only content and no editing affordance.
- **Error / Disabled:** invalid state appears in a red-tinted notice; unavailable file types remain visible in the registry at reduced opacity.

### Navigation

The file registry is a compact tree of 34px rows and remains present across document, inquiry, indicator, and configuration views. Documents are the implicit default, with no corresponding navigation entry. Questions and Indicators are horizontal text tabs at the top of the main surface; their active state uses annotation blue and a two-pixel underline. The bottom-left account avatar keeps a 42px operable target and opens a compact identity-and-logout menu upward so it never competes with the document tabs. Default file rows are transparent; hover reveals a translucent paper field; selected rows use washed annotation blue with darker blue text and a stronger weight. Chevron rotation uses the same 160ms ease-out as controls. Long names truncate, and nested levels indent without adding connector-line noise.

### Document Toolbar

The toolbar names the active document and places its format and size opposite it in tabular numerals.

### Information Margin

The right margin is a colophon for metadata, read-only status, local-processing assurance, and SHA-256 identity. In the questions view, it states that useful excerpts are transmitted to OpenAI and separately verifies that source documents remain read-only. Georgia section headings, small tabular metadata, green verification marks, and binding rules make privacy visible without competing with the document. When the margin is removed at the compact breakpoint, the transmission disclosure must remain visible in the inquiry hero.

### Questions, Answers, and Indicators

The inquiry surface uses the same paper field and typographic voices as document reading. Questions use a plain bordered textarea and one blue action; answers read as editorial prose, followed by structured fields and collapsible cited sources. Pinning is an explicit secondary step with a named value preview.

Saved indicators are ruled records, not elevated cards. Each shows semantic freshness, a serif title, a large tabular value, last-success metadata, sources, and a restrained refresh action. The last reliable value remains primary when refresh fails. A lone indicator spans the complete grid. Destructive removal requires confirmation and a clearly operable target; compact typography must not reduce the interactive area below the product's accessible control floor.

### Feedback and Loading

Success, error, and informational notices use softly tinted semantic fields with dark readable text. Loading states are quiet paper-toned skeleton rules; the startup state uses a single traveling blue rule. All animation and transition durations collapse under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:

- **Do** preserve the registry–document–security hierarchy whenever width permits.
- **Do** move essential actions with their content when a secondary panel is hidden.
- **Do** use annotation blue for active, focused, or selected states.
- **Do** use Georgia selectively for the bookish voice and Inter/system sans for dense operation.
- **Do** keep focus visible and honor reduced-motion preferences.
- **Do** express document safety as understandable state, not as decorative security theater.
- **Do** disclose OpenAI excerpt transmission before activation and keep that disclosure visible anywhere the questions view remains available.
- **Do** preserve citations and the last reliable value as the trust anchors for answers and indicators.

### Don't:

- **Don't** turn the preview into a floating card or reduce the document to a dashboard tile.
- **Don't** introduce cool white chrome, neon accents, gradients, glass effects, or heavy drop shadows.
- **Don't** use green or red without a real success, safety, error, or conflict meaning.
- **Don't** introduce editing, creation, save, or destructive affordances anywhere in the document flow.
- **Don't** present assisted search as implicit, fully local, or available without per-space consent.
- **Don't** turn questions and indicators into an unrelated analytics dashboard; keep them within the registry–reading–security hierarchy.
- **Don't** use a tiny text link as the only destructive target; deletion remains confirmed, explicit, and comfortably operable.
- **Don't** over-round every region; rules and spacing are the primary structure.
