-- ============================================================
-- PABLO23 BETS — RESULTADOS EN DIRECTO + AUTOELIMINACIÓN
-- ============================================================
-- Incluye las DOS funciones que pediste:
-- 1) El admin puede actualizar marcador/minuto mientras el partido
--    está en juego SIN liquidar apuestas.
-- 2) Si se elimina el último mercado de un partido, el partido se
--    elimina automáticamente.
--
-- IMPORTANTE:
-- - No toca cuotas ni combinadas.
-- - Cambiar el marcador NO resuelve ninguna apuesta.
-- - Resolver una selección sigue siendo una acción independiente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Campos para marcador en directo
-- ------------------------------------------------------------

alter table public.matches
  add column if not exists score_home integer not null default 0;

alter table public.matches
  add column if not exists score_away integer not null default 0;

alter table public.matches
  add column if not exists live_minute integer;

alter table public.matches
  add column if not exists is_live boolean not null default false;


-- ------------------------------------------------------------
-- 2. ADMIN: actualizar marcador en directo
-- ------------------------------------------------------------
-- Ejemplo:
-- 0-0 -> 1-0 -> 1-1 -> 2-1
--
-- Esto SOLO cambia el marcador/estado en matches.
-- NO liquida mercados, NO cambia bets y NO toca combinadas.
--
-- p_status es opcional. Si lo dejas NULL, conserva el estado actual.
-- Para un partido en juego puedes usar el estado que ya tengas
-- configurado en tu tabla (por ejemplo 'open').

create or replace function public.admin_update_live_result(
    p_match_id bigint,
    p_score_home integer,
    p_score_away integer,
    p_live_minute integer default null,
    p_is_live boolean default true,
    p_status text default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
    v_match public.matches;
begin

    if not public.is_admin() then
        raise exception 'No autorizado';
    end if;

    if p_score_home < 0 or p_score_away < 0 then
        raise exception 'El marcador no puede ser negativo';
    end if;

    if p_live_minute is not null and p_live_minute < 0 then
        raise exception 'El minuto no puede ser negativo';
    end if;

    update public.matches
    set
        score_home = p_score_home,
        score_away = p_score_away,
        live_minute = p_live_minute,
        is_live = p_is_live,
        status = coalesce(p_status, status)
    where id = p_match_id
    returning * into v_match;

    if not found then
        raise exception 'Partido no encontrado';
    end if;

    return v_match;
end;
$$;

grant execute on function public.admin_update_live_result(
    bigint, integer, integer, integer, boolean, text
) to authenticated;


-- ------------------------------------------------------------
-- 3. ADMIN: finalizar partido y guardar resultado 1/X/2
-- ------------------------------------------------------------
-- IMPORTANTE:
-- Esto tampoco liquida por sí solo mercados de otros tipos.
-- Para liquidar una selección concreta se sigue usando el sistema
-- de resolución de mercados que ya tienes.

create or replace function public.admin_finish_match(
    p_match_id bigint,
    p_score_home integer,
    p_score_away integer
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
    v_match public.matches;
    v_result text;
begin

    if not public.is_admin() then
        raise exception 'No autorizado';
    end if;

    if p_score_home < 0 or p_score_away < 0 then
        raise exception 'El marcador no puede ser negativo';
    end if;

    if p_score_home > p_score_away then
        v_result := 'home';
    elsif p_score_home < p_score_away then
        v_result := 'away';
    else
        v_result := 'draw';
    end if;

    update public.matches
    set
        score_home = p_score_home,
        score_away = p_score_away,
        live_minute = null,
        is_live = false,
        result = v_result,
        status = 'finished'
    where id = p_match_id
    returning * into v_match;

    if not found then
        raise exception 'Partido no encontrado';
    end if;

    return v_match;
end;
$$;

grant execute on function public.admin_finish_match(
    bigint, integer, integer
) to authenticated;


-- ------------------------------------------------------------
-- 4. AUTOELIMINACIÓN AL BORRAR EL ÚLTIMO MERCADO
-- ------------------------------------------------------------
-- Si borras mercados uno a uno:
--
--   Mercado 1 -> partido sigue
--   Mercado 2 -> partido sigue
--   Último mercado -> PARTIDO BORRADO
--
-- Esto es intencionado según tu petición.
-- No comprueba apuestas/historial antes de borrar.

create or replace function public.auto_delete_empty_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    if not exists (
        select 1
        from public.markets
        where match_id = old.match_id
    ) then

        delete from public.matches
        where id = old.match_id;

    end if;

    return old;
end;
$$;


drop trigger if exists trg_auto_delete_empty_match
on public.markets;

create trigger trg_auto_delete_empty_match
after delete on public.markets
for each row
execute function public.auto_delete_empty_match();


-- ------------------------------------------------------------
-- 5. ADMIN: borrar un mercado
-- ------------------------------------------------------------
-- Al borrar el último mercado, el trigger anterior elimina
-- automáticamente el partido.

create or replace function public.admin_delete_market(
    p_market_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.is_admin() then
        raise exception 'No autorizado';
    end if;

    delete from public.markets
    where id = p_market_id;

    if not found then
        raise exception 'Mercado no encontrado';
    end if;

end;
$$;

grant execute on function public.admin_delete_market(bigint)
to authenticated;


-- ------------------------------------------------------------
-- 6. ADMIN: cerrar/borrar TODOS los mercados de un partido
-- ------------------------------------------------------------
-- Según tu petición anterior:
-- si decides eliminar todos los mercados, el partido desaparece.
--
-- Esta función BORRA los mercados, no solo los marca cerrados.
-- Por tanto, al borrar el último, el trigger elimina el partido.

create or replace function public.admin_delete_all_match_markets(
    p_match_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.is_admin() then
        raise exception 'No autorizado';
    end if;

    delete from public.markets
    where match_id = p_match_id;

    -- El trigger trg_auto_delete_empty_match se encarga
    -- de borrar el partido automáticamente.
end;
$$;

grant execute on function public.admin_delete_all_match_markets(bigint)
to authenticated;


-- ------------------------------------------------------------
-- 7. OPCIONAL: poner un partido en directo
-- ------------------------------------------------------------
-- No es necesario para actualizar el marcador, pero permite
-- activar/desactivar fácilmente el indicador DIRECTO.

create or replace function public.admin_set_match_live(
    p_match_id bigint,
    p_is_live boolean
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
    v_match public.matches;
begin

    if not public.is_admin() then
        raise exception 'No autorizado';
    end if;

    update public.matches
    set is_live = p_is_live
    where id = p_match_id
    returning * into v_match;

    if not found then
        raise exception 'Partido no encontrado';
    end if;

    return v_match;
end;
$$;

grant execute on function public.admin_set_match_live(bigint, boolean)
to authenticated;


-- ============================================================
-- FIN
-- ============================================================
