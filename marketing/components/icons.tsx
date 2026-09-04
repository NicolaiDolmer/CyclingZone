// Stroke-ikoner porteret 1:1 fra frontend/src/components/ui/icons (kun de 8
// landing-fladen bruger). Samme IconBase-kontrakt: 24-viewBox, stroke=currentColor.

import type { ComponentProps, ReactNode } from "react";

type IconProps = Omit<ComponentProps<"svg">, "children"> & {
  size?: number;
  title?: string;
};

function IconBase({ size = 20, className = "", children, title, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 6L9 17l-5-5" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </IconBase>
  );
}

export function TeamIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17 14.2a5.5 5.5 0 0 1 3.5 4.8" />
    </IconBase>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8z" />
    </IconBase>
  );
}

export function CoinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 8.5a4 4 0 1 0 0 7" />
      <path d="M7 11h6M7 13.5h5" />
    </IconBase>
  );
}

export function MountainIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 19l6-11 4 6 2-3 6 8z" />
    </IconBase>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 21V4" />
      <path d="M5 5h13l-2.5 4 2.5 4H5z" />
      <path d="M5 9h11M11.5 5v8" />
    </IconBase>
  );
}
