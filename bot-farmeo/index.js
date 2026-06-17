require('dotenv').config();

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const db = require('./database');

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot farmeo activo');
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Servidor web activo');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
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

function username(interaction) {
  return interaction.member?.displayName || interaction.user.username;
}

async function sendOwnerDM(message) {
  try {
    if (!process.env.OWNER_ID) return;
    const owner = await client.users.fetch(process.env.OWNER_ID);
    await owner.send(message);
  } catch (err) {
    console.log('No pude enviar DM:', err.message);
  }
}

function sinceFor(period) {
  const d = new Date();

  if (period === 'todo') return 0;
  if (period === 'mes') return Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (period === 'semana') return Date.now() - 7 * 24 * 60 * 60 * 1000;

  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function cleanDiscordId(text) {
  if (!text) return null;
  return text.replace(/[<@!>]/g, '').trim();
}

function getUserPeriodStats(guildId, userId, periodo) {
  const rows = db.ranking(guildId, sinceFor(periodo));

  return rows.find(r => r.user_id === userId) || {
    total_seconds: 0,
    sesiones: 0
  };
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
            .addAttachmentOption(opt =>
              opt
                .setName('foto')
                .setDescription('Sube una foto como evidencia')
                .setRequired(true)
            )
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
    .setDescription('Ver ranking')
    .addStringOption(opt =>
      opt
        .setName('periodo')
        .setDescription('Periodo')
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
    .setDescription('Ver historial')
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

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
  const closed = participants.filter(p => p.status !== 'active');

  const activeText = active.length
    ? active.map(p => `🟢 <@${p.user_id}> — desde ${rel(p.started_at)}`).join('\n')
    : 'Nadie activo.';

  const closedText = closed.length
    ? closed.map(p => `⚫ <@${p.user_id}> — ${fmt(p.duration_seconds)}`).join('\n')
    : 'Nadie ha salido.';

  return new EmbedBuilder()
    .setTitle(`🟢 Farmeo grupal #${groupId}`)
    .setDescription(`Grupo: **${g.title}**\nLíder: <@${g.leader_id}>`)
    .addFields(
      { name: 'Activos', value: activeText.slice(0, 1024) },
      { name: 'Ya salieron', value: closedText.slice(0, 1024) }
    )
    .setFooter({
      text: g.status === 'active' ? 'Usa los botones.' : 'Grupo terminado.'
    });
}

function groupButtons(groupId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`join:${groupId}`)
        .setLabel('Unirse')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId(`leave:${groupId}`)
        .setLabel('Salir')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId(`end:${groupId}`)
        .setLabel('Terminar')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

async function refreshGroupMessage(interaction, groupId) {
  try {
    const g = db.getGroup(groupId);
    if (!g || !g.channel_id || !g.message_id) return;

    const channel = await interaction.guild.channels.fetch(g.channel_id);
    const msg = await channel.messages.fetch(g.message_id);

    await msg.edit({
      embeds: [groupEmbed(groupId)],
      components: groupButtons(groupId, g.status !== 'active')
    });
  } catch (err) {
    console.log('No pude actualizar grupo:', err.message);
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`Bot listo como ${c.user.tag}`);

  try {
    await registerCommands();
  } catch (err) {
    console.error('Error registrando comandos:', err);
  }
});

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot || !message.guild) return;

    const args = message.content.trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    if (command !== '!fechas') return;

    const userId = cleanDiscordId(args[1]);

    if (!userId || !/^\d{17,20}$/.test(userId)) {
      return message.reply(
        '⚠️ Uso correcto: `!fechas ID_DE_DISCORD`\nEjemplo: `!fechas 1508988018290065539`\nTambién puedes usar: `!fechas @usuario`'
      );
    }

    const hoy = getUserPeriodStats(message.guild.id, userId, 'hoy');
    const semana = getUserPeriodStats(message.guild.id, userId, 'semana');
    const mes = getUserPeriodStats(message.guild.id, userId, 'mes');
    const todo = getUserPeriodStats(message.guild.id, userId, 'todo');

    const embed = new EmbedBuilder()
      .setTitle('📅 Horas de farmeo')
      .setDescription(`Usuario: <@${userId}>`)
      .addFields(
        {
          name: '📌 Hoy',
          value: `⏱️ ${fmt(hoy.total_seconds)}\n📦 ${hoy.sesiones} sesiones`,
          inline: true
        },
        {
          name: '📆 Semana',
          value: `⏱️ ${fmt(semana.total_seconds)}\n📦 ${semana.sesiones} sesiones`,
          inline: true
        },
        {
          name: '🗓️ Mes',
          value: `⏱️ ${fmt(mes.total_seconds)}\n📦 ${mes.sesiones} sesiones`,
          inline: true
        },
        {
          name: '🏁 Total',
          value: `⏱️ ${fmt(todo.total_seconds)}\n📦 ${todo.sesiones} sesiones`,
          inline: false
        }
      )
      .setFooter({ text: 'Solo cuenta farmeos ya terminados.' });

    return message.reply({ embeds: [embed] });

  } catch (err) {
    console.error('Error en !fechas:', err);
    return message.reply('❌ Error interno usando `!fechas`.');
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
          const foto = interaction.options.getAttachment('foto');

          if (!foto || !foto.contentType || !foto.contentType.startsWith('image/')) {
            return interaction.editReply(
              '⚠️ Debes subir una imagen válida para iniciar farmeo.'
            );
          }

          const r = db.startSolo(
            guildId,
            interaction.user.id,
            username(interaction)
          );

          if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);

          await sendOwnerDM(
            `🟢 **${interaction.user.tag} inició farmeo**\n` +
            `👤 Usuario: <@${interaction.user.id}>\n` +
            `📅 Fecha: <t:${Math.floor(Date.now() / 1000)}:F>\n` +
            `🖼️ Foto enviada: ${foto.url}`
          );

          return interaction.editReply({
            content: `🟢 <@${interaction.user.id}> inició farmeo solo con evidencia.`,
            files: [foto.url]
          });
        }

        if (group === 'solo' && sub === 'terminar') {
          const r = db.endSolo(guildId, interaction.user.id);

          if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);

          await sendOwnerDM(
            `🔴 **${interaction.user.tag} terminó farmeo solo**\n` +
            `👤 Usuario: <@${interaction.user.id}>\n` +
            `📅 Fecha: <t:${Math.floor(Date.now() / 1000)}:F>\n` +
            `⏱️ Tiempo farmeado: **${fmt(r.duration_seconds)}**`
          );

          return interaction.editReply(
            `🔴 <@${interaction.user.id}> terminó farmeo solo.\nTiempo: **${fmt(r.duration_seconds)}**`
          );
        }

        if (group === 'grupo' && sub === 'crear') {
          const title = interaction.options.getString('nombre') || 'Farmeo';

          const r = db.createGroup(
            guildId,
            interaction.user.id,
            username(interaction),
            title,
            interaction.channelId
          );

          if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);

          const msg = await interaction.editReply({
            embeds: [groupEmbed(r.group_id)],
            components: groupButtons(r.group_id),
            fetchReply: true
          });

          db.setGroupMessage(r.group_id, msg.id);
          return;
        }
      }

      if (interaction.commandName === 'estado') {
        const st = db.activeStatus(guildId);

        const solo = st.solo.length
          ? st.solo.map(s =>
              `🟢 <@${s.user_id}> — desde ${rel(s.started_at)}`
            ).join('\n')
          : 'Nadie en farmeo solo.';

        const grupos = st.grupos.length
          ? st.grupos.map(g => {
              const active = db.groupParticipants(g.id, false);

              const miembros = active.length
                ? active.map(p =>
                    `- <@${p.user_id}> desde ${rel(p.started_at)}`
                  ).join('\n')
                : 'Sin participantes activos.';

              return `👥 **Grupo #${g.id}: ${g.title}**\n${miembros}`;
            }).join('\n\n')
          : 'No hay grupos activos.';

        const embed = new EmbedBuilder()
          .setTitle('📋 Estado actual de farmeo')
          .addFields(
            { name: 'Farmeo solo', value: solo.slice(0, 1024) },
            { name: 'Farmeo grupal', value: grupos.slice(0, 1024) }
          );

        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'ranking') {
        const periodo = interaction.options.getString('periodo') || 'hoy';
        const rows = db.ranking(guildId, sinceFor(periodo));

        const text = rows.length
          ? rows.map((r, i) =>
              `**${i + 1}.** <@${r.user_id}> — **${fmt(r.total_seconds)}** en ${r.sesiones} sesiones`
            ).join('\n')
          : 'No hay registros cerrados en este periodo.';

        const embed = new EmbedBuilder()
          .setTitle(`🏆 Ranking de farmeo: ${periodo}`)
          .setDescription(text.slice(0, 4096));

        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'historial') {
        return interaction.editReply('📜 Historial próximamente.');
      }
    }

    if (interaction.isButton()) {
      const [action, idRaw] = interaction.customId.split(':');
      const groupId = Number(idRaw);
      const g = db.getGroup(groupId);

      if (!g) return interaction.editReply('⚠️ Este grupo ya no existe.');

      if (action === 'join') {
        const r = db.joinGroup(
          interaction.guildId,
          groupId,
          interaction.user.id,
          username(interaction)
        );

        if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);

        await refreshGroupMessage(interaction, groupId);

        return interaction.editReply(`✅ Te uniste al grupo: #${groupId}.`);
      }

      if (action === 'leave') {
        const r = db.leaveGroup(
          interaction.guildId,
          groupId,
          interaction.user.id
        );

        if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);

        await sendOwnerDM(
          `🚪 **${interaction.user.tag} salió de grupo**\n` +
          `👤 Usuario: <@${interaction.user.id}>\n` +
          `👥 Grupo: #${groupId} ${g.title}\n` +
          `📅 Fecha: <t:${Math.floor(Date.now() / 1000)}:F>\n` +
          `⏱️ Tiempo farmeado: **${fmt(r.duration_seconds)}**`
        );

        await refreshGroupMessage(interaction, groupId);

        return interaction.editReply(
          `🚪 Saliste del grupo #${groupId}.\nTiempo: **${fmt(r.duration_seconds)}**`
        );
      }

      if (action === 'end') {
        const r = db.closeGroup(
          interaction.guildId,
          groupId,
          interaction.user.id,
          true
        );

        if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);

        await sendOwnerDM(
          `🔴 **Grupo terminado**\n` +
          `👥 Grupo: #${groupId} ${g.title}\n` +
          `👤 Cerrado por: <@${interaction.user.id}>\n` +
          `📅 Fecha: <t:${Math.floor(Date.now() / 1000)}:F>\n` +
          `👥 Participantes cerrados: **${r.closed_count}**`
        );

        await refreshGroupMessage(interaction, groupId);

        return interaction.editReply(`🔴 Grupo #${groupId} terminado.`);
      }
    }
  } catch (err) {
    console.error('Error en interacción:', err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ Error interno.');
      }
    } catch (_) {}
  }
});

if (!process.env.TOKEN) {
  console.error('Falta TOKEN');
  process.exit(1);
}

client.login(process.env.TOKEN);
