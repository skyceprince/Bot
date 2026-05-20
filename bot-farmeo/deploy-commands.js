require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('farm')
    .setDescription('Control de farmeo')
    .addSubcommandGroup(group => group
      .setName('solo')
      .setDescription('Farmeo individual')
      .addSubcommand(sub => sub.setName('iniciar').setDescription('Inicia tu farmeo individual'))
      .addSubcommand(sub => sub.setName('terminar').setDescription('Termina tu farmeo individual'))
    )
    .addSubcommandGroup(group => group
      .setName('grupo')
      .setDescription('Farmeo en grupo')
      .addSubcommand(sub => sub
        .setName('crear')
        .setDescription('Crea una sesión de farmeo grupal')
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del farmeo, ejemplo: Mina norte').setRequired(false))
      )
    ),
  new SlashCommandBuilder()
    .setName('estado')
    .setDescription('Muestra quién está farmeando actualmente'),
  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Muestra ranking de farmeo')
    .addStringOption(opt => opt
      .setName('periodo')
      .setDescription('Periodo del ranking')
      .setRequired(false)
      .addChoices(
        { name: 'Hoy', value: 'hoy' },
        { name: 'Semana', value: 'semana' },
        { name: 'Mes', value: 'mes' },
        { name: 'Todo', value: 'todo' }
      )
    ),
  new SlashCommandBuilder()
    .setName('historial')
    .setDescription('Muestra historial de farmeo')
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a revisar').setRequired(false)),
  new SlashCommandBuilder()
    .setName('cerrar-sesion')
    .setDescription('Cierra a la fuerza sesiones abiertas de un usuario')
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
      throw new Error('Falta TOKEN, CLIENT_ID o GUILD_ID en el archivo .env');
    }
    console.log('Registrando comandos...');
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('Comandos registrados correctamente.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
