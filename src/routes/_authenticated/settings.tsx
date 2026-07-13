import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { getMyFbApp, updateMyFbApp } from "@/lib/profile.functions";
import { getConnectionStatus } from "@/lib/pages.functions";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, AlertTriangle, XCircle, Clock, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Ajustes — PagePilot" }] }),
  component: SettingsPage,
});

type UsageEntry = { pct: number; call_count?: number; total_time?: number; total_cputime?: number; ts: number } | null;

function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const [fbAppId, setFbAppId] = useState("");
  const [fbAppSecret, setFbAppSecret] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [fbAppId2, setFbAppId2] = useState("");
  const [fbAppSecret2, setFbAppSecret2] = useState("");
  const [hasSecret2, setHasSecret2] = useState(false);
  const [usage1, setUsage1] = useState<UsageEntry>(null);
  const [usage2, setUsage2] = useState<UsageEntry>(null);
  const [savingFb, setSavingFb] = useState(false);

  const getFb = useServerFn(getMyFbApp);
  const saveFb = useServerFn(updateMyFbApp);

  const reloadFb = () => {
    getFb().then((r) => {
      setFbAppId(r.fb_app_id);
      setHasSecret(r.has_secret);
      setFbAppId2(r.fb_app_id_2);
      setHasSecret2(r.has_secret_2);
      setUsage1(r.usage.app1);
      setUsage2(r.usage.app2);
    }).catch(() => {});
  };

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).single();
      setName(p?.full_name ?? "");
    });
    reloadFb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", u.user.id);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Perfil salvo");
  };

  const saveFbCreds = async (slot: 1 | 2) => {
    setSavingFb(true);
    try {
      if (slot === 1) {
        await saveFb({ data: { fb_app_id: fbAppId, fb_app_secret: fbAppSecret || undefined } });
        setFbAppSecret("");
        setHasSecret(hasSecret || !!fbAppSecret);
      } else {
        await saveFb({ data: { fb_app_id_2: fbAppId2, fb_app_secret_2: fbAppSecret2 || undefined } });
        setFbAppSecret2("");
        setHasSecret2(hasSecret2 || !!fbAppSecret2);
      }
      toast.success(`Credenciais do App #${slot} salvas`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSavingFb(false);
    }
  };

  const clearFbCreds = async (slot: 1 | 2) => {
    if (!confirm(`Remover credenciais do App #${slot}?`)) return;
    setSavingFb(true);
    try {
      await saveFb({ data: slot === 1 ? { clear: true } : { clear_2: true } });
      if (slot === 1) { setFbAppId(""); setFbAppSecret(""); setHasSecret(false); }
      else { setFbAppId2(""); setFbAppSecret2(""); setHasSecret2(false); }
      toast.success("Credenciais removidas");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    } finally {
      setSavingFb(false);
    }
  };

  const bar = (label: string, pct: number) => {
    const tone = pct >= 80 ? "bg-destructive" : pct >= 60 ? "bg-warning" : "bg-success";
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{Math.round(pct)}%</span>
        </div>
        <Progress value={Math.min(100, pct)} className={`h-1.5 [&>div]:${tone}`} />
      </div>
    );
  };
  const renderUsage = (u: UsageEntry) => {
    if (!u) return <div className="text-xs text-muted-foreground">Sem dados de uso ainda — execute "Renovar agora" em Páginas.</div>;
    return (
      <div className="space-y-2">
        {bar("Chamadas (call_count)", u.call_count ?? u.pct)}
        {bar("Tempo total (total_time)", u.total_time ?? 0)}
        {bar("CPU (total_cputime)", u.total_cputime ?? 0)}
        <div className="text-[10px] text-muted-foreground">Atualizado em {new Date(u.ts).toLocaleString("pt-BR")}</div>
      </div>
    );
  };

  const AppSlot = (props: {
    slot: 1 | 2;
    id: string; setId: (v: string) => void;
    secret: string; setSecret: (v: string) => void;
    hasSec: boolean;
    usage: UsageEntry;
  }) => (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">App #{props.slot}{props.slot === 2 && <span className="text-xs text-muted-foreground ml-2">(opcional, backup)</span>}</h3>
      </div>
      {renderUsage(props.usage)}
      <div>
        <Label>App ID</Label>
        <Input value={props.id} onChange={(e) => props.setId(e.target.value)} placeholder="123456789012345" className="mt-2" />
      </div>
      <div>
        <Label>App Secret</Label>
        <Input
          type="password"
          value={props.secret}
          onChange={(e) => props.setSecret(e.target.value)}
          placeholder={props.hasSec ? "•••••••••••• (salvo — deixe em branco para manter)" : "Cole aqui"}
          className="mt-2"
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => saveFbCreds(props.slot)} disabled={savingFb} size="sm">Salvar</Button>
        {(props.id || props.hasSec) && (
          <Button variant="outline" size="sm" onClick={() => clearFbCreds(props.slot)} disabled={savingFb}>Remover</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-8 max-w-3xl space-y-6">
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
          <h2 className="text-lg font-semibold">Facebook Apps (próprios)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure até 2 apps. Quando o uso do App #1 ultrapassar 80% da quota, o sistema alterna
            automaticamente para o App #2 nas próximas renovações de token. Encontre os valores em
            developers.facebook.com → seu App → Configurações → Básico.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <AppSlot slot={1} id={fbAppId} setId={setFbAppId} secret={fbAppSecret} setSecret={setFbAppSecret} hasSec={hasSecret} usage={usage1} />
          <AppSlot slot={2} id={fbAppId2} setId={setFbAppId2} secret={fbAppSecret2} setSecret={setFbAppSecret2} hasSec={hasSecret2} usage={usage2} />
        </div>
      </div>
    </div>
  );
}
