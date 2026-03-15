import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Script from "next/script";

const conthrax = localFont({
    src: "../public/conthrax-semibold.otf",
    variable: "--font-conthrax",
});

export const metadata: Metadata = {
    title: "Document",
    description: "Wrapped in Next.js",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={conthrax.variable}>
            <head>
            </head>
            <body>
                {children}

                <Script src="/scripts/disable-inspect.js" strategy="beforeInteractive" />
                {/* Firebase SDKs */}
                <Script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js" strategy="beforeInteractive" />
                <Script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-auth-compat.js" strategy="beforeInteractive" />
                <Script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-firestore-compat.js" strategy="beforeInteractive" />
                <Script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-database-compat.js" strategy="beforeInteractive" />

                {/* Firebase init + presence tracking (used by user, admin, superadmin) */}
                <Script src="/scripts/firebase-init.js" strategy="afterInteractive" />
                <Script src="/scripts/presence.js" strategy="afterInteractive" />
            </body>
        </html>
    );
}
