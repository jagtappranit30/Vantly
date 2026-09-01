import React from "react";

interface ProductivePointLogoProps {
  className?: string;
  size?: number;
}

export const ProductivePointLogo: React.FC<ProductivePointLogoProps> = ({ className = "", size = 40 }) => {
  return (
    <svg
      id="productive-point-logo"
      className={`select-none ${className}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Blue gradient for the left stem */}
        <linearGradient id="blueStemGrad" x1="33" y1="28" x2="58" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1458e0" />
          <stop offset="100%" stopColor="#0a2eb5" />
        </linearGradient>

        {/* Teal gradient for the right stem */}
        <linearGradient id="tealStemGrad" x1="45" y1="82" x2="88" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0055ff" />
          <stop offset="60%" stopColor="#00d2ff" />
          <stop offset="100%" stopColor="#00f5d4" />
        </linearGradient>

        {/* Shadow for depth/layer separation */}
        <filter id="logoShadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="1" dy="2" stdDeviation="2" floodOpacity="0.15" />
        </filter>
      </defs>

      {/* Scattered Pixel Blocks (Digital Left Stem Accent) */}
      <g opacity="0.95">
        {/* Top scattering pixels */}
        <rect x="29" y="24" width="4.5" height="4.5" rx="0.5" fill="#1458e0" />
        <rect x="35" y="16" width="3.5" height="3.5" rx="0.5" fill="#00d2ff" />
        <rect x="25" y="18" width="4" height="4" rx="0.5" fill="#0055ff" />
        <rect x="18" y="22" width="5" height="5" rx="0.5" fill="#1458e0" />
        <rect x="16" y="16" width="3" height="3" rx="0.5" fill="#0055ff" />
        <rect x="27" y="11" width="2" height="2" rx="0.5" fill="#0055ff" />
        <rect x="19" y="12" width="3" height="3" rx="0.5" fill="#00d2ff" />
      </g>

      {/* Left Stem */}
      <path
        d="M 33 28 L 47 28 L 59 82 L 45 82 Z"
        fill="url(#blueStemGrad)"
        filter="url(#logoShadow)"
      />

      {/* Right Stem with Arrowhead */}
      <path
        d="M 45 82 
           L 59 82 
           L 80 34 
           L 73 34 
           Z"
        fill="url(#tealStemGrad)"
      />
      
      {/* Arrowhead Cap */}
      <path
        d="M 68 35 
           L 88 18 
           L 84 41 
           Z"
        fill="url(#tealStemGrad)"
      />

      {/* Growth/Data Line Chart */}
      <g>
        {/* Line */}
        <line
          x1="52"
          y1="70"
          x2="77"
          y2="30"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* Nodes */}
        <circle cx="52" cy="70" r="3.5" fill="#0055ff" stroke="white" strokeWidth="2" />
        <circle cx="64.5" cy="50" r="3.5" fill="#00d2ff" stroke="white" strokeWidth="2" />
        <circle cx="77" cy="30" r="3.5" fill="#00f5d4" stroke="white" strokeWidth="2" />
      </g>
    </svg>
  );
};
