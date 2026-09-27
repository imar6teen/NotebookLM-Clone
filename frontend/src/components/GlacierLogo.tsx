interface GlacierLogoProps {
  className?: string;
}

export default function GlacierLogo({ className = "h-8 w-auto" }: GlacierLogoProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
    >
      <rect
        width="40"
        height="40"
        rx="10"
        fill="#0f172a"
        stroke="#7dd3fc"
        strokeOpacity="0.3"
        strokeWidth="1.5"
      />
      <path
        d="M12 28L20 12L28 28H12Z"
        fill="url(#ice-grad)"
        fillOpacity="0.8"
      />
      <circle cx="20" cy="18" r="3" fill="#ffffff" />
      <defs>
        <linearGradient
          id="ice-grad"
          x1="12"
          y1="12"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#0284c7" />
        </linearGradient>
      </defs>
    </svg>
  );
}
