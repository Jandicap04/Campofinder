begin;

do $$
declare
    admin_email text := null;
    matching_admins integer;
    admin_user_id uuid;
begin
    if admin_email is null then
        select count(*)
        into matching_admins
        from public.usuarios
        where rol = 'administrador'
          and bloqueado = false;

        if matching_admins <> 1 then
            raise exception 'Se necesita exactamente un administrador activo. Si hay varios, asigna admin_email al correo de la cuenta en este bloque; si no hay ninguno, registra una cuenta y asígnale primero el rol administrador.';
        end if;

        select id
        into admin_user_id
        from public.usuarios
        where rol = 'administrador'
          and bloqueado = false;
    else
        select count(*)
        into matching_admins
        from public.usuarios
        where lower(trim(correo)) = lower(trim(admin_email))
          and rol = 'administrador'
          and bloqueado = false;

        if matching_admins <> 1 then
            raise exception 'No se encontró exactamente un perfil administrador activo con ese correo. Verifica el correo y el rol antes de ejecutar este archivo.';
        end if;

        select id
        into admin_user_id
        from public.usuarios
        where lower(trim(correo)) = lower(trim(admin_email))
          and rol = 'administrador'
          and bloqueado = false;
    end if;

    insert into public.canchas (
        nombre,
        descripcion,
        precio,
        imagen_url,
        admin_id,
        hora_apertura,
        hora_cierre
    )
    select
        court.nombre,
        'Reserva por turnos de una hora.',
        null,
        court.imagen_url,
        admin_user_id,
        time '16:00',
        time '23:00'
    from (values
        ('Best FT5', 'imagenes/best ft5.png'),
        ('Blue 6', 'imagenes/blue6.png'),
        ('Cancha 1', 'imagenes/cancha1.png'),
        ('Cancha 2', 'imagenes/cancha2.png'),
        ('Don Balón', 'imagenes/donbalon.png'),
        ('La Bombonera', 'imagenes/labombonera.png'),
        ('La Cúpula', 'imagenes/lacupula.png'),
        ('La Arenosa', 'imagenes/larenosa.png'),
        ('La Mendoza', 'imagenes/La_mendoza.png'),
        ('León de Judá', 'imagenes/leondejuda.png'),
        ('Parque Color', 'imagenes/parquecolor.png'),
        ('Punto 30', 'imagenes/punto30.png')
    ) as court(nombre, imagen_url)
    where not exists (
        select 1
        from public.canchas existing
        where existing.admin_id = admin_user_id
          and existing.nombre = court.nombre
    );
end;
$$;

commit;
