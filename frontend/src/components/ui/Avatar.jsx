import { avatarClass, initialsFrom } from "./avatarStyles.js";

// Billede ELLER initialer (udledt af `name`). Neutral hairline-ring.
export default function Avatar({ name = "", src, size = "md", className = "", ...rest }) {
  return (
    <span
      role="img"
      aria-label={name || undefined}
      className={`${avatarClass({ size })} ${className}`}
      {...rest}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{initialsFrom(name)}</span>
      )}
    </span>
  );
}
