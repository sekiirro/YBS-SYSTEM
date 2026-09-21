// Compatibility aliases keep existing utility classes on the semantic theme.
const tone = (text, fill) => Object.fromEntries([50,100,200,300,400,500,600,700,800,900,950].map((shade) => [shade, `hsl(var(--${shade >= 500 ? fill : text}) / <alpha-value>)`]));
const info = tone('primary', 'legacy-info-fill');
const signal = tone('destructive', 'brand-crimson');
const neutral = tone('muted-foreground', 'foreground');

/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
      fontSize: { xs: ['0.8125rem', { lineHeight: '1.5' }] },
  		opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, `${i / 100}`])),
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
        white: 'hsl(var(--foreground) / <alpha-value>)',
        pearl: 'hsl(var(--brand-pearl) / <alpha-value>)',
        blue: info, sky: info, cyan: info, teal: info, indigo: info,
        green: info, emerald: info, lime: info,
        red: signal, rose: signal, pink: signal, orange: signal,
        purple: neutral, violet: neutral, fuchsia: neutral,
        amber: tone('warning', 'brand-pearl'), yellow: tone('warning', 'brand-pearl'),
        slate: neutral, gray: neutral, zinc: neutral, stone: neutral, neutral,
        nutri: {
          surface: 'hsl(var(--nutri-surface))', 'surface-2': 'hsl(var(--nutri-surface-2))',
          'border-strong': 'hsl(var(--nutri-border-strong))', 'border-soft': 'hsl(var(--nutri-border-soft))', 'border-faint': 'hsl(var(--nutri-border-faint))',
          info: 'hsl(var(--nutri-info))', 'macro-p': 'hsl(var(--nutri-macro-p))', 'macro-c': 'hsl(var(--nutri-macro-c))', 'macro-f': 'hsl(var(--nutri-macro-f))',
        },
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
                foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
                foreground: 'hsl(var(--primary-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
                foreground: 'hsl(var(--primary-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)'],
  			display: ['var(--font-display)'],
  			mono: ['var(--font-mono)']
  		},
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
