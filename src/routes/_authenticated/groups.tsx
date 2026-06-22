import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listPages } from "@/lib/pages.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/groups")({
  head: () => ({ meta: [{ title: "Grupos — PagePilot" }] }),
  component: GroupsPage,
});

function GroupsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPages);
  const { data: pages = [] } = useQuery({ queryKey: ["pages"], queryFn: () => listFn() });

  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("page_groups").select("id, name, description, color, page_group_members(page_id)").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [sel, setSel] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user!.id;
      const { data: g, error } = await supabase.from("page_groups").insert({ user_id: userId, name, description: desc || null }).select().single();
      if (error) throw error;
      if (sel.length) {
        const rows = sel.map(pid => ({ group_id: g.id, page_id: pid, user_id: userId }));
        const { error: e2 } = await supabase.from("page_group_members").insert(rows);
        if (e2) throw e2;
      }
    },
    onSuccess: () => { toast.success("Grupo criado"); setOpen(false); setName(""); setDesc(""); setSel([]); qc.invalidateQueries({ queryKey: ["groups"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("page_groups").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Removido"); qc.invalidateQueries({ queryKey: ["groups"] }); },
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Grupos de páginas</h1>
          <p className="text-sm text-muted-foreground">Agrupe páginas para publicar em massa.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4 mr-2" />Novo grupo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo grupo</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
              <div><Label>Descrição</Label><Textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} /></div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Páginas</Label>
                  {pages.length > 0 && (
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={sel.length === pages.length && pages.length > 0}
                        onCheckedChange={v => setSel(v ? pages.map(p => p.id) : [])}
                      />
                      Marcar todas
                    </label>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto mt-2 border border-border rounded-md divide-y divide-border">
                  {pages.map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                      <Checkbox checked={sel.includes(p.id)} onCheckedChange={v => setSel(v ? [...sel, p.id] : sel.filter(x => x !== p.id))} />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter><Button disabled={!name || create.isPending} onClick={() => create.mutate()}>Criar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {groups.length === 0 && <div className="md:col-span-3 p-12 text-center text-sm text-muted-foreground border border-border rounded-xl bg-card">Nenhum grupo ainda.</div>}
        {groups.map((g: any) => (
          <div key={g.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <div><h3 className="font-semibold">{g.name}</h3><p className="text-xs text-muted-foreground mt-1">{g.description || "—"}</p></div>
              <Button size="icon" variant="ghost" onClick={() => { if (confirm("Excluir grupo?")) remove.mutate(g.id); }}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">{g.page_group_members?.length ?? 0} página(s)</div>
          </div>
        ))}
      </div>
    </div>
  );
}
