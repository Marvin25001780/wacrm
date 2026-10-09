'use client';

// ============================================================
// OrganizationForm — alta/edición de Empresas (migration 031).
// Mismo patrón que ContactForm: dialog + Supabase cliente + RLS.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Organization } from '@/types';
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
import { Loader2 } from 'lucide-react';

interface OrganizationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization?: Organization | null;
  onSaved: () => void;
}

export function OrganizationForm({
  open,
  onOpenChange,
  organization,
  onSaved,
}: OrganizationFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!organization;

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxId, setTaxId] = useState('');
  const [country, setCountry] = useState('Venezuela');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(organization?.name ?? '');
      setIndustry(organization?.industry ?? '');
      setWebsite(organization?.website ?? '');
      setPhone(organization?.phone ?? '');
      setEmail(organization?.email ?? '');
      setTaxId(organization?.tax_id ?? '');
      setCountry(organization?.country ?? 'Venezuela');
      setCity(organization?.city ?? '');
      setAddress(organization?.address ?? '');
      setNotes(organization?.notes ?? '');
    }
  }, [open, organization]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('El nombre de la empresa es obligatorio');
      return;
    }
    if (!accountId) {
      toast.error('Tu perfil no está vinculado a una cuenta.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No autenticado');

      const payload = {
        name: name.trim(),
        industry: industry.trim() || null,
        website: website.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        tax_id: taxId.trim() || null,
        country: country.trim() || null,
        city: city.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      };

      if (isEdit && organization) {
        const { error } = await supabase
          .from('organizations')
          .update(payload)
          .eq('id', organization.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('organizations').insert({
          ...payload,
          user_id: user.id,
          account_id: accountId,
        });
        if (error) throw error;
      }

      toast.success(isEdit ? 'Empresa actualizada' : 'Empresa creada');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al guardar la empresa';
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
            {isEdit ? 'Editar empresa' : 'Nueva empresa'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit
              ? 'Actualiza los datos de la empresa.'
              : 'Registra una empresa para vincular contactos y negocios.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name" className="text-muted-foreground">
              Nombre <span className="text-red-400">*</span>
            </Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme S.A."
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-industry" className="text-muted-foreground">
                Industria / sector
              </Label>
              <Input
                id="org-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Comercio, Servicios..."
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-tax" className="text-muted-foreground">
                RIF / Identificación fiscal
              </Label>
              <Input
                id="org-tax"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="J-12345678-9"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-phone" className="text-muted-foreground">
                Teléfono
              </Label>
              <Input
                id="org-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+58 412 1234567"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-email" className="text-muted-foreground">
                Correo electrónico
              </Label>
              <Input
                id="org-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contacto@empresa.com"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-website" className="text-muted-foreground">
              Sitio web
            </Label>
            <Input
              id="org-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://empresa.com"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-country" className="text-muted-foreground">
                País
              </Label>
              <Input
                id="org-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Venezuela"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-city" className="text-muted-foreground">
                Ciudad
              </Label>
              <Input
                id="org-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Caracas"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-address" className="text-muted-foreground">
              Dirección
            </Label>
            <Input
              id="org-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Av. Principal, Torre..."
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-notes" className="text-muted-foreground">
              Notas
            </Label>
            <Input
              id="org-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Información adicional..."
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
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
