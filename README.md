# Campofinder

Aplicación para descubrir y reservar canchas. El sitio funciona con React + Vite y Supabase Auth/PostgreSQL; no usa Flask, Python, XAMPP ni MySQL. Las imágenes originales se conservan en `static/imagenes` y Vite las publica bajo `/imagenes/`.

## Preparar Supabase

1. En **SQL Editor**, ejecuta [`supabase/schema.sql`](supabase/schema.sql). El esquema crea los perfiles, canchas, reservas, timers, horarios bloqueados, la tabla del marcador en vivo y la función que calcula turnos libres sin revelar reservas privadas. También activa RLS, configura la disponibilidad diaria de las canchas de **16:00 a 23:00** y solicita recargar el esquema de la API. Vuelve a ejecutar el archivo completo cuando cambie el esquema de la aplicación.
2. En **Project Settings → API**, copia la URL del proyecto y la clave publishable. Guárdalas en `frontend/.env.local`, tomando como referencia [`frontend/.env.example`](frontend/.env.example). Estas dos variables son públicas; nunca añadas la clave `service_role` a React, a Vite ni a un archivo `.env` del frontend.
3. En **Authentication → Providers → Email**, configura si los usuarios deben confirmar su correo antes de iniciar sesión.
4. Crea una cuenta desde el registro de la app. Para asignarle el rol de administrador inicial, en SQL Editor ejecuta:

   ```sql
   update public.usuarios
   set rol = 'administrador'
   where correo = 'admin@ejemplo.com';
   ```

   Sustituye el correo por el que registraste. El formulario público no permite asignar ese rol.
5. Carga las canchas incluidas en `static/imagenes`. Abre [`supabase/seed_canchas.sql`](supabase/seed_canchas.sql) y ejecuta el SQL en **SQL Editor**. Si existe exactamente un administrador activo, el script lo detecta automáticamente. Si hay varios, indica el correo escribiéndolo entre comillas en la variable `admin_email` del bloque SQL. Inserta 12 canchas asociadas a esa cuenta, con precio por consultar y turnos de una hora de 16:00 a 23:00. El script excluye `Campofinderlogo.png` y `logo1.png`; también omite `Cancha_La_Bombonera__115.png` porque es idéntica a `labombonera.png`. Se puede ejecutar de nuevo sin duplicar esas canchas.

   Los nombres y las imágenes se derivan de los archivos locales. El script no elimina ni modifica las cuentas, reservas o canchas existentes.

## Desplegar la función administrativa

Crear, eliminar y cambiar la contraseña de otras cuentas requiere privilegios de Supabase Auth. Por seguridad, esas acciones pasan por la Edge Function TypeScript [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts); React nunca recibe la clave privada. Supabase proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno de la función.

Despliega la función desde una terminal con Node.js y la CLI de Supabase:

```powershell
npx supabase login
npx supabase link --project-ref mbrqulttwvolbxdxdtbb
npx supabase functions deploy admin-users
```

`supabase login` requiere autorización de la cuenta del proyecto. Si no tienes acceso, pide al propietario que ejecute esos comandos. No compartas aquí contraseñas, tokens de acceso, claves `service_role` ni credenciales de base de datos.

## Ejecutar React + Vite en Windows

Instala Node.js 20 o superior. No hace falta instalar Python.

1. Crea `frontend/.env.local` a partir de `frontend/.env.example` y completa la URL y la clave publishable de tu proyecto.
2. En PowerShell:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

3. Abre la dirección de Vite, normalmente `http://127.0.0.1:5173`.

Para comprobar la versión de producción:

```powershell
npm run build
npm run preview
```

La carpeta `frontend/dist` puede publicarse en cualquier servicio de hosting estático compatible con SPA. No hace falta arrancar un servidor Flask.

### Desplegar en Vercel

El archivo [`vercel.json`](vercel.json) configura Vercel para instalar las dependencias de `frontend/`, compilar con Vite y publicar `frontend/dist`; también permite recargar rutas internas de React Router. En **Project Settings → Environment Variables**, agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` para los entornos que vayas a desplegar. Deja **Root Directory** en la raíz del repositorio para que Vercel lea esta configuración.

## Datos y seguridad

- Registro, inicio y cierre de sesión usan Supabase Auth desde React.
- Reservas, horarios disponibles, perfiles, roles, timers, bloqueos y marcadores se leen y escriben en Supabase PostgreSQL mediante `@supabase/supabase-js`.
- RLS protege las tablas. La reserva se valida en una función SQL para impedir reservas duplicadas y reservas en horarios bloqueados.
- Los horarios de reserva se generan a partir de la apertura y cierre de cada cancha. El último turno diario es de 22:00 a 23:00; los turnos pasados del día actual dejan de mostrarse. El inicio y el catálogo consultan `get_public_court_status` para mostrar el número de turnos libres de hoy sin revelar los datos privados de las reservas.
- El administrador puede iniciar un partido desde una reserva próxima en **Panel de control → Marcador en vivo**. El equipo que reservó aparece como `Team [nombre del perfil]` y el rival como `Team visitante`; después se pueden actualizar los goles o finalizar el partido. Al iniciarlo comienza una cuenta regresiva real de 60 minutos hasta `00:00`, visible al administrador y sobre la foto de la cancha en el inicio y catálogo. Supabase Realtime actualiza el marcador y el cronómetro se recupera correctamente al recargar.
- La página de inicio está enfocada únicamente en fútbol y rota automáticamente las fotos de las canchas, sin mostrar los logos como fondos.
- En el inicio, el mapa aparece a la derecha y comienza en el centro de Soacha indicado por el enlace de Google Maps compartido (`4.5810514, -74.235904`, zoom 14). A la izquierda se listan canchas Campofinder con su disponibilidad de hoy y reloj en vivo. Quien visita puede centrar el mapa en su ubicación con el botón; si deniega el permiso, el listado y el mapa inicial siguen visibles. La geolocalización solo se solicita al pulsarlo y el navegador requiere HTTPS o localhost para autorizarla.
- Para recibir actualizaciones en directo, la tabla `partidos_en_vivo` se añade a la publicación `supabase_realtime` al ejecutar el esquema.
- Las acciones administrativas de Auth se validan en una Edge Function; solo los administradores activos pueden invocarla.
- El rol de administrador se asigna inicialmente desde SQL Editor. Nunca confíes en un rol proporcionado por el navegador.
- Los archivos existentes en `data/` son datos heredados del backend anterior y no se importan automáticamente a Supabase; consérvalos hasta migrar cualquier información que necesites.
