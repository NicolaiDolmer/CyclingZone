export default function Link({ as: As = "a", className = "", children, ...rest }) {
  return (
    <As
      className={`font-semibold text-cz-accent-t underline decoration-cz-border underline-offset-2 transition-colors duration-150 hover:decoration-cz-accent-t ${className}`}
      {...rest}
    >
      {children}
    </As>
  );
}
