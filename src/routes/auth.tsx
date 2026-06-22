import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Entrar — PagePilot" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard" });
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada. Entrando…");
    navigate({ to: "/dashboard" });
  };

  const onGoogle = async () => {
    setLoading(true);
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/dashboard" });
    if (r.error) { setLoading(false); return toast.error(r.error.message || "Falha no Google"); }
    if (r.redirected) return;
    navigate({ to: "/dashboard" });
  };

  const onReset = async () => {
    if (!email) return toast.error("Digite seu e-mail primeiro");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    if (error) return toast.error(error.message);
    toast.success("E-mail de recuperação enviado");
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 justify-center mb-6">
          <div className="size-8 rounded-md bg-primary grid place-items-center text-primary-foreground font-bold">P</div>
          <span className="font-semibold tracking-tight">PagePilot</span>
        </Link>
        <div className="rounded-xl border border-border bg-card p-6">
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full mb-6">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={onSignIn} className="space-y-4">
                <div className="space-y-2"><Label>E-mail</Label><Input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div className="space-y-2"><Label>Senha</Label><Input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
                <Button className="w-full" type="submit" disabled={loading}>Entrar</Button>
                <button type="button" onClick={onReset} className="block w-full text-xs text-muted-foreground hover:text-foreground">Esqueci minha senha</button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={onSignUp} className="space-y-4">
                <div className="space-y-2"><Label>Nome</Label><Input required value={name} onChange={e => setName(e.target.value)} /></div>
                <div className="space-y-2"><Label>E-mail</Label><Input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div className="space-y-2"><Label>Senha</Label><Input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></div>
                <Button className="w-full" type="submit" disabled={loading}>Criar conta</Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="relative my-6"><div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div><div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">ou</span></div></div>

          <Button type="button" variant="outline" className="w-full" onClick={onGoogle} disabled={loading}>
            <svg className="mr-2 size-4" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1H12v3.2h5.35c-.23 1.2-1.6 3.5-5.35 3.5-3.22 0-5.85-2.66-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.94 3.5 14.7 2.5 12 2.5 6.96 2.5 2.88 6.58 2.88 11.85S6.96 21.2 12 21.2c6.93 0 9.5-4.86 9.5-9.35z" /></svg>
            Continuar com Google
          </Button>
        </div>
      </div>
    </div>
  );
}
