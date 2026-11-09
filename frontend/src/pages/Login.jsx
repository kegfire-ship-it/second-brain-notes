import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Logo from '@/components/ui/logo';
import NoiseGradient from '@/components/ui/noise-gradient';
import api from '../services/api';
import { startSession } from '../services/offlineNotes';
import { useTheme } from '@/lib/theme';

// Login-only palette: white drifting into our soft teal (#0d9488 family).
const GRADIENT_COLORS = ['#FFFFFF', '#99F6E4', '#2DD4BF'];
// Dark theme: graphite page drifting into deep teal.
const GRADIENT_COLORS_DARK = ['#0F1318', '#134E4A', '#0F766E'];

export default function Login() {
    const { resolved } = useTheme();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    const submit = async (e) => {
        e.preventDefault();
        if (!password || isLoading) return;
        setIsLoading(true);
        setError('');
        try {
            const response = await api.post('/auth/login', { password });
            await startSession(response.data.access_token);
            navigate('/');
        } catch (err) {
            const status = err.response?.status;
            if (status === 401) setError('Wrong password');
            else if (status === 429) setError('Too many attempts. Please wait 15 minutes.');
            else setError('Can’t reach the server. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
            <NoiseGradient
                key={resolved}
                colors={resolved === 'dark' ? GRADIENT_COLORS_DARK : GRADIENT_COLORS}
                className="fixed inset-0 -z-10 h-full w-full"
            />

            <form
                onSubmit={submit}
                className="relative w-full max-w-md rounded-3xl border border-white/60 bg-white/55 p-8 dark:border-line-2/60 dark:bg-surface/70 backdrop-blur-xl backdrop-saturate-150"
                style={{ boxShadow: 'var(--shadow-modal)' }}
            >
                <Logo className="mx-auto mb-6 h-16 w-16 rounded-2xl shadow-sm" />
                <h1 className="text-center font-display text-3xl font-semibold text-ink">Second Brain</h1>
                <p className="mt-2 mb-8 text-center text-ink-2">Enter your password to open your notes</p>

                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    aria-label="Password"
                    autoFocus
                    autoComplete="current-password"
                    className="mb-3 h-11 w-full rounded-lg border border-line-2 bg-white/60 px-4 text-base text-ink outline-none dark:bg-surface/60"
                />
                <Button type="submit" size="lg" disabled={!password || isLoading} className="h-11 w-full">
                    {isLoading ? 'Signing in…' : 'Sign in'}
                </Button>

                {error && (
                    <p className="mt-4 text-center text-sm font-medium text-destructive">{error}</p>
                )}
            </form>
        </div>
    );
}
