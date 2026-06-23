import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getMyFbApp, updateMyFbApp } from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Ajustes — PagePilot" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const [fbAppId, setFbAppId] = useState("");
  const [fbAppSecret, setFbAppSecret] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [savingFb, setSavingFb] = useState(false);

  const getFb = useServerFn(getMyFbApp);
  const saveFb = useServerFn(updateMyFbApp);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).single();
      setName(p?.full_name ?? "");
    });
    getFb().then((r) => {
      setFbAppId(r.fb_app_id);
      setHasSecret(r.has_secret);
    }).catch(() => {});
  }, [getFb]);

  const save = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", u.user.id);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Perfil salvo");
  };

  const saveFbCreds = async () => {
    setSavingFb(true);
    try {
      await saveFb({ data: { fb_app_id: fbAppId, fb_app_secret: fbAppSecret || undefined } });
      toast.success("Credenciais do Facebook salvas");
      setFbAppSecret("");
      setHasSecret(hasSecret || !!fbAppSecret);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSavingFb(false);
    }
  };

  const clearFbCreds = async () => {
    if (!confirm("Remover suas credenciais do Facebook App?")) return;
    setSavingFb(true);
    try {
      await saveFb({ data: { clear: true } });
      setFbAppId("");
      setFbAppSecret("");
      setHasSecret(false);
      toast.success("Credenciais removidas");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    } finally {
      setSavingFb(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Suas informações de perfil e integrações.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div><Label>E-mail</Label><Input value={email} disabled className="mt-2" /></div>
        <div><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-2" /></div>
        <Button onClick={save} disabled={loading}>Salvar</Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Facebook App (próprio)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Use seu próprio App do Facebook para renovar/estender tokens das suas páginas.
            Encontre estes valores em developers.facebook.com → seu App → Configurações → Básico.
          </p>
        </div>
        <div>
          <Label>App ID</Label>
          <Input
            value={fbAppId}
            onChange={(e) => setFbAppId(e.target.value)}
            placeholder="123456789012345"
            className="mt-2"
          />
        </div>
        <div>
          <Label>App Secret</Label>
          <Input
            type="password"
            value={fbAppSecret}
            onChange={(e) => setFbAppSecret(e.target.value)}
            placeholder={hasSecret ? "•••••••••••• (salvo — deixe em branco para manter)" : "Cole aqui"}
            className="mt-2"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={saveFbCreds} disabled={savingFb}>Salvar credenciais</Button>
          {(fbAppId || hasSecret) && (
            <Button variant="outline" onClick={clearFbCreds} disabled={savingFb}>Remover</Button>
          )}
        </div>
      </div>
    </div>
  );
}
