"use client";
import Script from "next/script";

export default function Login() {
    const css = `
    body { font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; }
    input { width: 100%; padding: 10px; margin: 8px 0; box-sizing: border-box; }
    button { background-color: #4285f4; color: white; padding: 10px; border: none; width: 100%; }
    .error { color: red; margin-top: 10px; }
  `;

    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: css }} />

            <div className="top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '20px' }}>
                <img style={{ width: '200px' }} src="/logo2.png" alt="/" />
                <span style={{ fontSize: '32px', fontFamily: "'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif", marginTop: '40px' }}>Prava Izlab</span>
            </div>

            <h1>Login</h1>
            <form id="loginForm">
                <input type="email" id="email" placeholder="Email" required />
                <input type="password" id="password" placeholder="Password" required />
                <button type="submit">Login</button>
            </form>
            <p id="error" className="error"></p>

            <Script src="/scripts/auth.js" strategy="lazyOnload" />
        </>
    );
}
