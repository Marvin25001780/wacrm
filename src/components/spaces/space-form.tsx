'use client';

// ============================================================
// SpaceForm — alta/edición de un Espacio de trabajo (migration 036).
// Dialog + Supabase cliente + RLS. Nombre, descripción y color.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { type Space } from '@/types';
import { SPACE_COLORS, spaceColor } from '@/lib/spaces/colors';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Check } from 'lucide-react';

interface SpaceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space?: Space | null;
  onSaved: () => void;
}

export function SpaceForm({ open, onOpenChange, space, onSaved }: SpaceFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!space;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('primary');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(space?.name ?? '');
      setDescription(space?.description ?? '');
      setColor(space?.color ?? 'primary');
    }
  }, [open, space]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }
    if (!accountId) {
      toast.error('Tu perfil no está vinculado a una cuenta.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        color,
      };

      if (isEdit && space) {
        const { error } = await supabase.from('spaces').update(payload).eq('id', space.id);
        if (error) throw error;
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error('No autenticado');

        const { error } = await supabase.from('spaces').insert({
          ...payload,
          account_id: accountId,
          created_by: user.id,
        });
        if (error) throw error;
      }

      toast.success(isEdit ? 'Espacio actualizado' : 'Espacio creado');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar el espacio';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? 'Editar espacio' : 'Nuevo espacio de trabajo'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Agrupa a tu equipo y a los registros con los que trabaja.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="space-name" className="text-muted-foreground">
              Nombre <span className="text-red-400">*</span>
            </Label>
            <Input
              id="space-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Equipo de Ventas"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="space-desc" className="text-muted-foreground">
              Descripción
            </Label>
            <Textarea
              id="space-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="¿De qué se encarga este espacio?"
              rows={3}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Color</Label>
            <div className="flex flex-wrap gap-2">
              {SPACE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  className={
                    'flex size-8 items-center justify-center rounded-full border transition-all ' +
                    (color === c.value
                      ? 'border-foreground/60 ring-2 ring-ring/40'
                      : 'border-border')
                  }
                >
                  <span className={'size-4 rounded-full ' + spaceColor(c.value).dot} />
                  {color === c.value && (
                    <Check className="absolute size-3 text-background mix-blend-difference" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
