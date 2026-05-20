require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const db = require('./database');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('estado')
    .setDescription('Ver usuarios activos'),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Ver ranking de farmeo'),

  new SlashCommandBuilder()
    .setName('historial')
    .setDescription('Ver historial'),

  new SlashCommandBuilder()
    .setName('farm')
    .setDescription('Sistema de farmeo')
    .addSubcommandGroup(group =>
      group
        .setName('solo')
        .setDescription('Farmeo solo')
        .addSubcommand(sub =>
          sub
            .setName('iniciar')
            .setDescription('Iniciar farmeo solo')
        )
        .addSubcommand(sub =>
          sub
            .setName('terminar')
            .setDescription('Terminar farmeo solo')
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('grupo')
        .setDescription('Farmeo grupal')
        .addSubcommand(sub =>
          sub
            .setName('crear')
            .setDescription('Crear grupo')
            .addStringOption(opt =>
              opt
                .setName('nombre')
                .setDescription('Nombre del grupo')
                .setRequired(false)
            )
        )
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registrando comandos...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('Comandos registrados.');
  } catch (error) {
    console.error(error);
  }
})();

function fmt(seconds) {
  seconds = Math.max(0, Number(seconds || 0));

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function groupEmbed(groupId) {
  const g = db.getGroup(groupId);
  const participants = db.groupParticipants(groupId, true);

  const active = participants.filter(p => p.status === 'active');

  const activeText = active.length
    ? active.map(p => `🟢 <@${p.user_id}>`).join('\n')
    : 'Nadie activo.';

  return new EmbedBuilder()
    .setTitle(`🟢 Farmeo grupal`)
    .setDescription(`Grupo: ${g.title}`)
    .addFields({
      name: 'Participantes',
      value: activeText
    });
}

function groupButtons(groupId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`join:${groupId}`)
        .setLabel('Unirme')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`leave:${groupId}`)
        .setLabel('Salir')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`end:${groupId}`)
        .setLabel('Terminar')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

client.once(Events.ClientReady, c => {
  console.log(`Bot listo como ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {

    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === 'estado') {
        return interaction.reply('📋 Sistema funcionando.');
      }

      if (interaction.commandName === 'ranking') {
        return interaction.reply('🏆 Ranking próximamente.');
      }

      if (interaction.commandName === 'historial') {
        return interaction.reply('📜 Historial próximamente.');
      }

      if (interaction.commandName === 'farm') {

        const group = interaction.options.getSubcommandGroup();
        const sub = interaction.options.getSubcommand();

        if (group === 'solo' && sub === 'iniciar') {

          db.startSolo(
            interaction.guildId,
            interaction.user.id,
            interaction.user.username
          );

          return interaction.reply(
            `🟢 <@${interaction.user.id}> inició farmeo solo.`
          );
        }

        if (group === 'solo' && sub === 'terminar') {

          const r = db.endSolo(
            interaction.guildId,
            interaction.user.id
          );

          if (!r.ok) {
            return interaction.reply({
              content: 'No tienes sesión activa.',
              ephemeral: true
            });
          }

          return interaction.reply(
            `🔴 <@${interaction.user.id}> terminó farmeo.\nTiempo: ${fmt(r.duration_seconds)}`
          );
        }

        if (group === 'grupo' && sub === 'crear') {

          const title =
            interaction.options.getString('nombre') ||
            'Farmeo';

          const r = db.createGroup(
            interaction.guildId,
            interaction.user.id,
            interaction.user.username,
            title,
            interaction.channelId
          );

          const msg = await interaction.reply({
            embeds: [groupEmbed(r.group_id)],
            components: groupButtons(r.group_id),
            fetchReply: true
          });

          db.setGroupMessage(r.group_id, msg.id);

          return;
        }
      }
    }

    if (interaction.isButton()) {

      const [action, idRaw] = interaction.customId.split(':');

      const groupId = Number(idRaw);

      if (action === 'join') {

        db.joinGroup(
          interaction.guildId,
          groupId,
          interaction.user.id,
          interaction.user.username
        );

        return interaction.reply({
          content: '✅ Te uniste.',
          ephemeral: true
        });
      }

      if (action === 'leave') {

        const r = db.leaveGroup(
          interaction.guildId,
          groupId,
          interaction.user.id
        );

        return interaction.reply({
          content: `🚪 Saliste.\nTiempo: ${fmt(r.duration_seconds)}`,
          ephemeral: true
        });
      }

      if (action === 'end') {

        db.closeGroup(
          interaction.guildId,
          groupId,
          interaction.user.id,
          true
        );

        return interaction.reply('🔴 Grupo terminado.');
      }
    }

  } catch (err) {
    console.error(err);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'Error interno.',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: 'Error interno.',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.TOKEN);
