-- WOLF BETS V11 - ELIMINAR PARTIDO DESDE LOS 3 PUNTOS
-- Ejecutar una sola vez en Supabase SQL Editor.
-- Solo permite borrar partidos que NO tengan apuestas ni combinadas.

create or replace function public.admin_delete_match(
    p_match_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    bet_count integer;
    combo_count integer;
begin
    if not public.is_admin() then
        raise exception 'No autorizado';
    end if;

    select count(*) into bet_count
    from public.bets
    where match_id = p_match_id;

    select count(*) into combo_count
    from public.combo_bet_legs cbl
    join public.markets m on m.id = cbl.market_id
    where m.match_id = p_match_id;

    if bet_count > 0 or combo_count > 0 then
        raise exception 'No se puede borrar este partido porque ya tiene apuestas o combinadas. Ciérralo/cancélalo para conservar el historial.';
    end if;

    delete from public.matches where id = p_match_id;

    if not found then
        raise exception 'Partido no encontrado';
    end if;
end;
$$;

grant execute on function public.admin_delete_match(bigint) to authenticated;
