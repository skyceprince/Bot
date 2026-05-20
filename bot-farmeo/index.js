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

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function fmt(seconds) {
  seconds = Math.max(0, Number(seconds || 0));

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;

  return `${s}s`;
}

function rel(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function ts(ms) {
  return `<t:${Math.floor(ms / 1000)}:f>`;
}

function username(interaction) {
  return interaction.member?.displayName || interaction.user.username;
}

async function sendOwnerDM(message) {
  try {
    if (!process.env.OWNER_ID) return;

    const owner = await client.users.fetch(process.env.OWNER_ID);

    await owner.send(message);

  } catch (err) {
    console.log('No pude mandar DM:', err.message);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('farm')
    .setDescription('Sistema de farmeo')

    .addSubcommandGroup(group =>
      group
        .setName('solo')
        .setDescription('Farmeo individual')

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
    ),

  new SlashCommandBuilder()
    .setName('estado')
    .setDescription('Ver quién está farmeando'),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Ver ranking'),

  new SlashCommandBuilder()
    .setName('historial')
    .setDescription('Ver historial')

].map(cmd => cmd.toJSON());

async function registerCommands() {

  const rest = new REST({ version: '10' })
    .setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log('Comandos registrados.');
}

function groupEmbed(groupId) {

  const g = db.getGroup(groupId);

  const participants = db.groupParticipants(groupId, true);

  const active = participants.filter(p => p.status === 'active');

  const activeText = active.length
    ? active.map(p =>
        `🟢 <@${p.user_id}> — desde ${rel(p.started_at)}`
      ).join('\n')
    : 'Nadie activo.';

  return new EmbedBuilder()
    .setTitle(`🟢 Farmeo grupal #${groupId}`)
    .setDescription(`Grupo: ${g.title}`)
    .addFields({
      name: 'Activos',
      value: activeText
    });
}

function groupButtons(groupId) {

  return [
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(`join:${groupId}`)
          .setLabel('Unirme')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`leave:${groupId}`)
          .setLabel('Salir')
          .setEmoji('🚪')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(`end:${groupId}`)
          .setLabel('Terminar')
          .setEmoji('🔴')
          .setStyle(ButtonStyle.Danger)

      )
  ];
}

client.once(Events.ClientReady, async c => {

  console.log(`Bot listo como ${c.user.tag}`);

  try {

    await registerCommands();

  } catch (err) {

    console.error(err);

  }
});

client.on(Events.InteractionCreate, async interaction => {

  try {

    if (interaction.isChatInputCommand()) {
      await interaction.deferReply();
    }

    if (interaction.isButton()) {
      await interaction.deferReply({ flags: 64 });
    }

    if (interaction.isChatInputCommand()) {

      const guildId = interaction.guildId;

      if (interaction.commandName === 'farm') {

        const group = interaction.options.getSubcommandGroup();

        const sub = interaction.options.getSubcommand();

        if (group === 'solo' && sub === 'iniciar') {

          const r = db.startSolo(
            guildId,
            interaction.user.id,
            username(interaction)
          );

          if (!r.ok) {

            return interaction.editReply(
              `⚠️ ${r.reason}`
            );
          }

          return interaction.editReply(
            `🟢 <@${interaction.user.id}> inició farmeo solo.`
          );
        }

        if (group === 'solo' && sub === 'terminar') {

          const r = db.endSolo(
            guildId,
            interaction.user.id
          );

          if (!r.ok) {

            return interaction.editReply(
              `⚠️ ${r.reason}`
            );
          }

          await sendOwnerDM(
            `🔴 Farmeo terminado\nUsuario: ${interaction.user.tag}\nTiempo: ${fmt(r.duration_seconds)}`
          );

          return interaction.editReply(
            `🔴 <@${interaction.user.id}> terminó farmeo.\nTiempo: ${fmt(r.duration_seconds)}`
          );
        }

        if (group === 'grupo' && sub === 'crear') {

          const title =
            interaction.options.getString('nombre')
            || 'Farmeo';

          const r = db.createGroup(
            guildId,
            interaction.user.id,
            username(interaction),
            title,
            interaction.channelId
          );

          const msg = await interaction.editReply({
            embeds: [groupEmbed(r.group_id)],
            components: groupButtons(r.group_id),
            fetchReply: true
          });

          db.setGroupMessage(
            r.group_id,
            msg.id
          );

          return;
        }
      }

      if (interaction.commandName === 'estado') {

        const st = db.activeStatus(guildId);

        const solo = st.solo.length
          ? st.solo.map(s =>
              `🟢 <@${s.user_id}> — desde ${rel(s.started_at)}`
            ).join('\n')
          : 'Nadie en solo.';

        const grupos = st.grupos.length
          ? st.grupos.map(g =>
              `👥 Grupo #${g.id}: ${g.title}`
            ).join('\n')
          : 'No hay grupos activos.';

        const embed = new EmbedBuilder()
          .setTitle('📋 Estado actual')
          .addFields(
            {
              name: 'Farmeo solo',
              value: solo
            },
            {
              name: 'Farmeo grupal',
              value: grupos
            }
          );

        return interaction.editReply({
          embeds: [embed]
        });
      }

      if (interaction.commandName === 'ranking') {

        return interaction.editReply(
          '🏆 Ranking próximamente.'
        );
      }

      if (interaction.commandName === 'historial') {

        return interaction.editReply(
          '📜 Historial próximamente.'
        );
      }
    }

    if (interaction.isButton()) {

      const [action, idRaw] =
        interaction.customId.split(':');

      const groupId = Number(idRaw);

      if (action === 'join') {

        db.joinGroup(
          interaction.guildId,
          groupId,
          interaction.user.id,
          username(interaction)
        );

        return interaction.editReply(
          '✅ Te uniste.'
        );
      }

      if (action === 'leave') {

        const r = db.leaveGroup(
          interaction.guildId,
          groupId,
          interaction.user.id
        );

        await sendOwnerDM(
          `🚪 Usuario salió del grupo\nUsuario: ${interaction.user.tag}\nTiempo: ${fmt(r.duration_seconds)}`
        );

        return interaction.editReply(
          `🚪 Saliste.\nTiempo: ${fmt(r.duration_seconds)}`
        );
      }

      if (action === 'end') {

        db.closeGroup(
          interaction.guildId,
          groupId,
          interaction.user.id,
          true
        );

        return interaction.editReply(
          '🔴 Grupo terminado.'
        );
      }
    }

  } catch (err) {

    console.error(err);

    try {

      if (interaction.deferred || interaction.replied) {

        await interaction.editReply(
          '❌ Error interno.'
        );

      } else {

        await interaction.reply({
          content: '❌ Error interno.',
          flags: 64
        });

      }

    } catch (_) {}
  }
});

if (!process.env.TOKEN) {

  console.error('Falta TOKEN');

  process.exit(1);
}

client.login(process.env.TOKEN);
