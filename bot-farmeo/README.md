# Bot Farmeo Completo

Bot de Discord para controlar farmeo individual y grupal.

## Funciones

- `/farm solo iniciar` inicia una sesión individual.
- `/farm solo terminar` termina tu sesión individual.
- `/farm grupo crear` crea una sesión grupal con botones.
- Botones: `Unirme`, `Salirme`, `Terminar grupo`.
- `/estado` muestra quién está farmeando ahora.
- `/ranking` muestra ranking por día, semana, mes o todo.
- `/historial` muestra últimas sesiones de un usuario.
- `/cerrar-sesion` permite cerrar sesiones abiertas de un usuario, útil para admins.

## Instalar

```bash
npm install
```

Copia `.env.example`, cambia el nombre a `.env` y llena:

```env
TOKEN=token_del_bot
CLIENT_ID=id_del_bot
GUILD_ID=id_de_tu_server
ADMIN_ROLE_ID=id_del_rol_admin_opcional
```

Registrar comandos:

```bash
npm run deploy
```

Iniciar bot:

```bash
npm start
```

## Permisos del bot

Invítalo con permisos para:

- Send Messages
- Use Slash Commands
- Embed Links
- Read Message History

## Notas

- La base de datos se crea sola en `farm.sqlite`.
- Si `ADMIN_ROLE_ID` está vacío, solo quien creó un grupo puede terminarlo con el botón. Admins de Discord también pueden usar `/cerrar-sesion` si tienen permiso de administrador.
