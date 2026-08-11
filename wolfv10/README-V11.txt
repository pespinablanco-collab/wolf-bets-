WOLF BETS V11

CAMBIOS:
- Menu ⋮ junto a cada partido visible solo para ADMIN.
- Editar partido desde el menu.
- Editar marcador/minuto/directo desde un overlay.
- Finalizar partido desde el overlay de directo.
- Cerrar apuestas.
- Gestionar selecciones/cuotas.
- Eliminar partido con confirmacion.
- Borrador local automatico al crear un partido: conserva campos, imagenes/URLs y selecciones aunque se salga del editor.
- Las selecciones del borrador se crean automaticamente en Supabase al guardar el partido.
- Los escudos ahora leen correctamente home_logo_url y away_logo_url.

SQL:
Si tu Supabase YA tiene la funcion admin_delete_match del ADMIN V4, no necesitas ejecutar nada.
Si solo ejecutaste los 5 codigos que pasaste en el chat y no tienes esa funcion, ejecuta:
SQL-V11-ELIMINAR-PARTIDO.sql

El resto de las funciones de directo usan las funciones existentes del SQL de resultados en directo:
admin_update_live_result
admin_set_match_live
admin_finish_match
