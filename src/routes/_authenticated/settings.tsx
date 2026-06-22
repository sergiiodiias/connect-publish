import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Ajustes — PagePilot" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).single();
      setName(p?.full_name ?? "");
    });
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

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Suas informações de perfil.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div><Label>E-mail</Label><Input value={email} disabled className="mt-2" /></div>
        <div><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-2" /></div>
        <Button onClick={save} disabled={loading}>Salvar</Button>
      </div>
    </div>
  );
}
