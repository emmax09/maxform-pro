/** A compact form-lines mark. BrandLogo supplies the orange rounded tile. */
export const StackedLogo = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="3" y="3" width="12" height="2.5" rx="1.25" fill={color} />
    <rect x="3" y="7.75" width="12" height="2.5" rx="1.25" fill={color} />
    <rect x="3" y="12.5" width="12" height="2.5" rx="1.25" fill={color} />
  </svg>
);
