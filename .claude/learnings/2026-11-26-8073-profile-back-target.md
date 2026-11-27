# Small Back controls on rider and team profiles

Refs #8073, #8737.

The T3 profiles used a compact text button. Its 16 px line height also set the hit area. The approved target is 44 × 44 px with the icon and profile header in the same positions.

The button gains a real minimum size. Balanced logical margins reuse the surrounding space. The compensation follows the original rem-based line height and spacing so larger browser default text does not move the profile.

For compact controls, record target hit testing and neighboring geometry before changing CSS. Exercise keyboard navigation and enlarged default text in the same preview fixtures.
