'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Radio, Briefcase, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'broadcast' | 'deal';
  status: string;
}

export default function CalendarPage() {
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    const supabase = createClient();

    const [broadcastsRes, dealsRes] = await Promise.all([
      supabase.from('broadcasts').select('id, name, created_at, status').order('created_at', { ascending: true }),
      supabase.from('deals').select('id, title, expected_close_date, status').not('expected_close_date', 'is', null).order('expected_close_date', { ascending: true }),
    ]);

    const items: CalendarEvent[] = [];

    broadcastsRes.data?.forEach((b) => {
      items.push({ id: b.id, title: b.name, date: b.created_at, type: 'broadcast', status: b.status });
    });

    dealsRes.data?.forEach((d) => {
      if (d.expected_close_date) {
        items.push({ id: d.id, title: d.title, date: d.expected_close_date, type: 'deal', status: d.status });
      }
    });

    setEvents(items);
    setLoading(false);
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);

  const days = useMemo(() => {
    const d = [];
    let day = calendarStart;
    while (day <= calendarEnd) {
      d.push(day);
      day = addDays(day, 1);
    }
    return d;
  }, [calendarStart, calendarEnd]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((ev) => {
      const key = format(parseISO(ev.date), 'yyyy-MM-dd');
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    return map;
  }, [events]);

  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const today = new Date();

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Calendario</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visualiza tus emisiones y negocios programados.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={prevMonth} className="border-border text-muted-foreground hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground min-w-32 text-center">
            {format(currentMonth, "MMMM yyyy", { locale: es })}
          </span>
          <Button variant="outline" size="icon-sm" onClick={nextMonth} className="border-border text-muted-foreground hover:bg-muted">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDay[key] ?? [];
            const isToday = isSameDay(day, today);
            const isCurrentMonth = isSameMonth(day, currentMonth);

            return (
              <div
                key={key}
                className={cn(
                  'min-h-24 border-b border-r border-border p-1 transition-colors hover:bg-muted/30',
                  !isCurrentMonth && 'bg-muted/20',
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                    isToday && 'bg-primary text-primary-foreground font-semibold',
                    !isToday && isCurrentMonth && 'text-foreground',
                    !isCurrentMonth && 'text-muted-foreground',
                  )}
                >
                  {format(day, 'd')}
                </span>
                <div className="mt-1 space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => router.push(ev.type === 'broadcast' ? `/broadcasts/${ev.id}` : '/pipelines')}
                      className={cn(
                        'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] transition-colors',
                        ev.type === 'broadcast'
                          ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                          : 'bg-primary/10 text-primary hover:bg-primary/20',
                      )}
                    >
                      {ev.type === 'broadcast' ? <Radio className="h-2.5 w-2.5 shrink-0" /> : <Briefcase className="h-2.5 w-2.5 shrink-0" />}
                      <span className="truncate">{ev.title}</span>
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="block px-1 text-[10px] text-muted-foreground">
                      +{dayEvents.length - 3} más
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}