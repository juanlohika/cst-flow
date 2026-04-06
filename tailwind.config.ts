import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-family-primary)"],
      },
      colors: {
        border: "var(--color-border-default)",
        "border-default": "var(--color-border-default)",
        input: "var(--color-gray-200)",
        ring: "var(--color-blue-500)",
        background: "var(--color-surface-default)",
        foreground: "var(--color-text-primary)",
        
        /* Surface colors */
        "surface-default": "var(--color-surface-default)",
        "surface-subtle": "var(--color-surface-subtle)",
        "surface-muted": "var(--color-surface-muted)",
        "surface-table-header": "var(--color-surface-table-header)",
        
        /* Text colors */
        "text-primary": "var(--color-text-primary)",
        "text-muted": "var(--color-text-muted)",
        "text-secondary": "var(--color-text-secondary)",
        
        /* Primary brand colors */
        primary: {
          DEFAULT: "var(--color-primary)",
          foreground: "white",
          hover: "var(--color-primary-hover)",
          bg: "var(--color-primary-bg)",
        },
        
        /* Secondary colors */
        secondary: {
          DEFAULT: "var(--color-gray-100)",
          foreground: "var(--color-text-primary)",
        },
        
        /* Destructive */
        destructive: {
          DEFAULT: "#EF4444",
          foreground: "white",
        },
        
        /* Muted / Subtle */
        muted: {
          DEFAULT: "var(--color-surface-muted)",
          foreground: "var(--color-text-secondary)",
        },
        
        /* Accent */
        accent: {
          DEFAULT: "var(--color-primary-bg)",
          foreground: "var(--color-primary)",
        },
        
        /* Popover */
        popover: {
          DEFAULT: "white",
          foreground: "var(--color-text-primary)",
        },
        
        /* Card */
        card: {
          DEFAULT: "white",
          foreground: "var(--color-text-primary)",
        },
        
        /* Gray scale */
        gray: {
          50: "var(--color-gray-50)",
          100: "var(--color-gray-100)",
          200: "var(--color-gray-200)",
          300: "var(--color-gray-300)",
          500: "var(--color-gray-500)",
          600: "var(--color-gray-600)",
          800: "var(--color-gray-800)",
        },
      },
      fontSize: {
        xs: "var(--font-size-xs)",
        sm: "var(--font-size-sm)",
        base: "var(--font-size-base)",
        md: "var(--font-size-md)",
        lg: "var(--font-size-lg)",
        xl: "var(--font-size-xl)",
        "2xl": "var(--font-size-2xl)",
      },
      fontWeight: {
        normal: "var(--font-weight-regular)",
        medium: "var(--font-weight-medium)",
        semibold: "var(--font-weight-semibold)",
        bold: "var(--font-weight-bold)",
      },
      borderRadius: {
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
      },
      spacing: {
        "bar-h": "var(--spacing-bar-h)",
        "nav-w": "var(--spacing-nav-w)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
