# Entre nosotros · Amigo secreto

Aplicación en español con frontend estático para **Vercel**, API Node.js/Express para **Railway** y **PostgreSQL**. Sin datos simulados en el flujo de producción.

## Usar la versión local

Requisitos: Node.js 24 y pnpm 11.19.0 (`corepack enable`).

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

En esta máquina Node.js está instalado como copia portátil en `%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64` y no está en el `PATH`, así que `node` y `pnpm` no funcionan en una terminal normal. Usa el atajo `dev.cmd`, que encuentra esa copia por su cuenta (doble clic o desde la terminal):

```bat
dev.cmd          :: inicia el servidor en http://localhost:3000
dev.cmd test     :: ejecuta las pruebas
dev.cmd build    :: genera dist/
dev.cmd seed     :: crea las cuentas (solo la primera vez)
```

Si prefieres usar `pnpm` directamente, añade esa carpeta al `PATH` de tu usuario en Windows; entonces funcionan los comandos `pnpm` de arriba.

Abre http://localhost:3000. `setup:local` crea `.env`, una base PostgreSQL embebida en `.local-db/` y un archivo privado `credentials-<fecha>.txt` con un administrador y seis participantes (`persona1` a `persona6`). La configuración local ya fue creada durante la implementación; en esta carpeta basta ejecutar `dev.cmd` si el servidor no está activo. No ejecutes dos procesos sobre la misma base embebida.

Las contraseñas se generan al azar; no hay una contraseña universal. El seed no sobrescribe cuentas existentes. El archivo de credenciales, `.env` y los datos locales están excluidos de Git y de la imagen Docker. Elimina el archivo de credenciales después de entregarlas de forma privada.

## Cómo se juega

1. Entra como administrador. Edita nombres/usuarios, añade o quita participantes y establece contraseñas iniciales. El administrador no participa; si quieres jugar, usa una cuenta de participante separada.
2. Entrega a cada persona su cuenta. Cada participante debe cambiar la contraseña inicial por una propia. Es obligatorio que todos estén listos y haya al menos **3 participantes**; máximo 200.
3. La primera persona que pulsa **Descubrir mi amigo secreto** cierra la lista. El servidor genera el sorteo completo en una transacción. Nadie se obtiene a sí mismo y cada destinatario aparece exactamente una vez. Se permiten parejas recíprocas.
4. La animación muestra números aleatorios decorativos. El sorteo real utiliza aleatoriedad criptográfica en el servidor; no se envían nombres de otras asignaciones al navegador.
5. Cada persona ve solo su resultado. Recargar, entrar otra vez, hacer doble clic o participar simultáneamente conserva la asignación.

Al cerrar la lista, el panel bloquea altas, bajas, nombres, usuarios y restablecimiento de contraseñas. Esto evita que el administrador cambie una cuenta para suplantar a su propietario. Los participantes pueden cambiar su propia contraseña conociendo la actual. No existe reinicio, repetición del sorteo ni recuperación administrativa después del sorteo; conserva tu contraseña.

## Desplegar en Railway

1. Sube el proyecto a tu repositorio privado y crea un servicio desde ese repositorio en Railway, con la raíz de este proyecto. `railway.json` selecciona el `Dockerfile`.
2. Añade PostgreSQL al proyecto de Railway. Conecta `DATABASE_URL` del backend a la variable del servicio PostgreSQL (habitualmente `${{Postgres.DATABASE_URL}}`; usa el nombre real de tu servicio).
3. Configura `NODE_ENV=production` y `APP_ORIGIN=https://TU-PROYECTO.vercel.app`, sin barra final. Usa el dominio definitivo del frontend. Railway inyecta `PORT`. No configures `LOCAL_DATABASE` en producción.
4. Genera el dominio público HTTPS del backend. El chequeo `/api/health` debe devolver `{"ok":true}`. Las tablas y protecciones se crean al iniciar; requieren que el usuario de la conexión pueda crearlas. Las migraciones son idempotentes y no alteran asignaciones existentes.
5. Crea las cuentas **una sola vez**, desde tu máquina. La base de Railway es privada por omisión: abre el servicio PostgreSQL → **Settings → Networking → Public Access** para crear el proxy TCP temporal. Eso genera la variable `DATABASE_PUBLIC_URL`; cópiala a un archivo privado `.env.production` y añádele `?sslmode=no-verify`:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://USUARIO:CONTRASENA@HOST:PUERTO/railway?sslmode=no-verify
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ELIGE_UNA_CONTRASENA_LARGA_Y_UNICA
SEED_PARTICIPANTS=6
```

```bat
dev.cmd seed-prod
```

En Linux o macOS el equivalente es `node --env-file=.env.production server/seed.js`.

`sslmode=no-verify` cifra la conexión pero no valida el certificado. Es necesario aquí: la imagen PostgreSQL de Railway usa un certificado autofirmado, y `sslmode=require` en `pg` 8.16 exige una autoridad pública, así que fallaría; sin ningún `sslmode`, `pg` se conectaría **sin cifrado** por Internet, que es peor. Es una conexión única, desde tu máquina, para crear cuentas. El backend en Railway no usa esta ruta: habla con la base por la red privada del proyecto.

Al terminar, **desactiva Public Access** en ese servicio y borra `.env.production`. La URL privada `${{Postgres.DATABASE_URL}}` del backend no se toca. Esto guarda las credenciales iniciales en tu máquina, en `credentials-<fecha>.txt`. Sustituye todos los valores de ejemplo. Después del seed elimina las variables de bootstrap que ya no necesites. No añadas el seed al comando de inicio.

## Desplegar el frontend en Vercel

1. En `vercel.json`, sustituye `https://REEMPLAZAR-BACKEND.up.railway.app` por el dominio HTTPS real del backend. Conserva `/api/:path*` en la URL de destino.
2. Importa el repositorio en Vercel. Directorio raíz: este proyecto. Framework: **Other**; Node.js: **24.x**; instalación: `pnpm install --frozen-lockfile`; build: `pnpm run build`; salida: `dist`.
3. Publica y comprueba que el dominio coincida exactamente con `APP_ORIGIN` de Railway. Si usas dominio personalizado, actualiza `APP_ORIGIN`. Los despliegues preview no pueden realizar escrituras con un origen diferente: usa una base y backend de pruebas si los necesitas.
4. Accede por Vercel. Las peticiones relativas `/api/*` pasan al backend por el proxy, manteniendo las cookies en el mismo sitio. No hace falta CORS abierto ni guardar tokens en localStorage. El frontend no necesita variables de base de datos ni secretos.

Referencias oficiales: [reescrituras hacia orígenes externos de Vercel](https://vercel.com/docs/routing/rewrites), [Express en Railway](https://docs.railway.com/guides/express), [PostgreSQL en Railway](https://docs.railway.com/databases/postgresql).

**Estado de entrega:** aplicación implementada y comprobada en local (pruebas y recorrido completo de la interfaz: login, cambio de contraseña, sorteo con animación, resultado permanente y panel del organizador con la lista cerrada). No se ha publicado en Vercel/Railway. Falta, en este orden: publicar el repositorio en GitHub, crear el servicio de Railway con PostgreSQL, poner su dominio en `vercel.json`, importar el proyecto en Vercel y ejecutar el seed de producción.

## Seguridad y alcance de la privacidad

- Consultas SQL parametrizadas; ningún dato de usuario se concatena en SQL.
- Contraseñas con scrypt, sal aleatoria individual y comparación de tiempo constante.
- Sesiones opacas aleatorias; solo su hash se almacena en PostgreSQL. Cookies HttpOnly, SameSite=Lax, Secure en producción y expiración a 8 horas. Cambiar contraseña invalida sesiones anteriores.
- Comprobación de origen y Content-Type en operaciones de escritura, límite de tamaño de peticiones, validación de datos, CSP y cabeceras de seguridad.
- Límite persistente de intentos por usuario y global, compartido entre réplicas. No confía en cabeceras IP manipulables.
- Transacción con bloqueo de la fila del juego que serializa el primer sorteo y los cambios de cuentas. Restricciones UNIQUE/CHECK y triggers que impiden actualizar, borrar o truncar las asignaciones y reabrir el juego.
- La API administrativa no consulta ni devuelve asignaciones. Los endpoints de revelación obtienen siempre el participante desde la sesión, nunca desde un ID enviado por el cliente.

La privacidad se garantiza frente a las funciones del **panel administrativo**, no frente al propietario de la infraestructura. Quien tenga acceso directo al servidor, al código, a la base de datos o a sus copias puede inspeccionar datos o retirar protecciones. No es criptografía de extremo a extremo. Tampoco es posible demostrar quién es una persona únicamente mediante una cuenta inicialmente creada por el organizador: entrega las credenciales al participante correcto y deja que cambie su contraseña antes del sorteo. Con tres participantes, algunos resultados pueden deducirse matemáticamente.

Activa copias de seguridad de PostgreSQL y conserva la base de datos; el estado permanente depende de ella. No ejecutes pruebas ni sorteos de demostración contra la base de producción.

## Comprobaciones

```bat
dev.cmd test
dev.cmd build
```

O `pnpm test` y `pnpm build` si tienes Node en el `PATH`. Las nueve pruebas pasan en esta carpeta (Node 24.21.0). Para revisar la interfaz sin tocar la base local, `node scripts/preview-test.js` levanta una copia desechable en memoria en http://127.0.0.1:3001.

Las pruebas usan PostgreSQL embebido aislado (PGlite), sin modificar datos locales ni producción: autenticación, inyección SQL, origen, permisos, cambio de contraseña, revocación de sesiones, altas/bajas/edición, sorteo simultáneo e idempotente, unicidad, bloqueo de modificaciones en API y base de datos, límite de intentos y cierre de sesión. La integración con las instancias reales de Vercel/Railway debe comprobarse después del despliegue.

Se incluye opcionalmente la herramienta WebMCP `reveal_my_secret_friend` en navegadores compatibles. Usa el mismo flujo visible y permisos que el botón; no omite la autenticación. Su registro se comprobó en el navegador, pero la revisión automática bloqueó la llamada de comprobación desde una sesión administrativa por considerarla una posible mutación irreversible. La validación de invocación WebMCP queda pendiente; la denegación al administrador sí se verificó directamente en las pruebas de la API.

## Estructura

- `public/`: interfaz responsiva, estilos, animaciones y favicon.
- `server/`: API, autenticación, PostgreSQL, esquema y seed.
- `scripts/`: preparación local y build estático.
- `test/`: pruebas aisladas de seguridad y reglas del juego.
- `vercel.json`, `railway.json`, `Dockerfile`: configuración de despliegue.
- `dev.cmd`: atajo de Windows para iniciar, probar, construir y sembrar sin configurar el `PATH`.

Para usar PostgreSQL real también en local, copia `.env.example` a `.env`, configura `DATABASE_URL`, elimina `LOCAL_DATABASE` y ejecuta el seed antes de iniciar el servidor.
