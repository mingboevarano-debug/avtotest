/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: false,
    async rewrites() {
        return [
            { source: '/index.html', destination: '/' },
            { source: '/login.html', destination: '/login' },
            { source: '/admin.html', destination: '/admin' },
            { source: '/statistics.html', destination: '/statistics' },
            { source: '/superadmin.html', destination: '/superadmin' },
        ];
    },
};

export default nextConfig;
