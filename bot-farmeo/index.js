require('dotenv').config();

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

function username(interaction) {
  return interaction.member?.displayName || interaction.user.username;
}

function sinceFor(period) {
  const d = new Date();

  if (period === 'todo') return 0;
  if (period === 'mes') return Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (period === 'semana') return Date.now() - 7 * 24 * 60 * 60 * 1000;

  d.setHours(0, 0, 0, 0);
  return d.getTime();
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
          sub.setName('iniciar').setDescription('Iniciar farmeo solo')
        )
        .addSubcommand(sub =>
          sub.setName('terminar').setDescription('Terminar farmeo solo')
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
    : 'Nadie ha salido todavía.';

  return new EmbedBuilder()
    .setTitle(`🟢 Farmeo grupal #${groupId}`)
    .setDescription(`Grupo: **${g.title}**\nLíder: <@${g.leader_id}>`)
    .addFields(
      {
        name: 'Activos',
        value: activeText.slice(0, 1024)
      },
      {
        name: 'Ya salieron',
        value: closedText.slice(0, 1024)
      }
    )
    .setFooter({
      text: g.status === 'active'
        ? 'Usa los botones para unirte, salir o terminar.'
        : 'Grupo terminado.'
    });
}

function groupButtons(groupId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`join:${groupId}`)
        .setLabel('Unirme')
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
    console.log('No pude actualizar mensaje del grupo:', err.message);
  }
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
            return interaction.editReply(`⚠️ ${r.reason}`);
          }

          return interaction.editReply(
            `🟢 <@${interaction.user.id}> inició farmeo solo.`
          );
        }

        if (group === 'solo' && sub === 'terminar') {
          const r = db.endSolo(guildId, interaction.user.id);

          if (!r.ok) {
            return interaction.editReply(`⚠️ ${r.reason}`);
          }

          await sendOwnerDM(
            `🔴 Farmeo solo terminado\nUsuario: ${interaction.user.tag}\nTiempo: ${fmt(r.duration_seconds)}`
          );

          return interaction.editReply(
            `🔴 <@${interaction.user.id}> terminó farmeo.\nTiempo: **${fmt(r.duration_seconds)}**`
          );
        }

        if (group === 'grupo' && sub === 'crear') {
          const title =
            interaction.options.getString('nombre') || 'Farmeo';

          const r = db.createGroup(
            guildId,
            interaction.user.id,
            username(interaction),
            title,
            interaction.channelId
          );

          if (!r.ok) {
            return interaction.editReply(`⚠️ ${r.reason}`);
          }

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
              `🟢 <@${s.user_id}> — solo desde ${rel(s.started_at)}`
            ).join('\n')
          : 'Nadie en farmeo solo.';

        const grupos = st.grupos.length
          ? st.grupos.map(g => {
              const active = db.groupParticipants(g.id, false);

              const miembros = active.length
                ? active.map(p => `- <@${p.user_id}> desde ${rel(p.started_at)}`).join('\n')
                : 'Sin participantes activos.';

              return `👥 **Grupo #${g.id}: ${g.title}**\nLíder: <@${g.leader_id}>\n${miembros}`;
            }).join('\n\n')
          : 'No hay grupos activos.';

        const embed = new EmbedBuilder()
          .setTitle('📋 Estado actual de farmeo')
          .addFields(
            {
              name: 'Farmeo solo',
              value: solo.slice(0, 1024)
            },
            {
              name: 'Farmeo grupal',
              value: grupos.slice(0, 1024)
            }
          );

        return interaction.editReply({
          embeds: [embed]
        });
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

        return interaction.editReply({
          embeds: [embed]
        });
      }

      if (interaction.commandName === 'historial') {
        return interaction.editReply('📜 Historial próximamente.');
      }
    }

    if (interaction.isButton()) {
      const [action, idRaw] = interaction.customId.split(':');
      const groupId = Number(idRaw);
      const g = db.getGroup(groupId);

      if (!g) {
        return interaction.editReply('⚠️ Este grupo ya no existe.');
      }

      if (action === 'join') {
        const r = db.joinGroup(
          interaction.guildId,
          groupId,
          interaction.user.id,
          username(interaction)
        );

        if (!r.ok) {
          return interaction.editReply(`⚠️ ${r.reason}`);
        }

        await refreshGroupMessage(interaction, groupId);

        return interaction.editReply(
          `✅ Te uniste al grupo #${groupId}.`
        );
      }

      if (action === 'leave') {
        const r = db.leaveGroup(
          interaction.guildId,
          groupId,
          interaction.user.id
        );

        if (!r.ok) {
          return interaction.editReply(`⚠️ ${r.reason}`);
        }

        await sendOwnerDM(
          `🚪 Usuario salió del grupo\nUsuario: ${interaction.user.tag}\nGrupo: #${groupId} ${g.title}\nTiempo: ${fmt(r.duration_seconds)}`
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

        if (!r.ok) {
          return interaction.editReply(`⚠️ ${r.reason}`);
        }

        await sendOwnerDM(
          `🔴 Grupo terminado\nGrupo: #${groupId} ${g.title}\nCerrado por: ${interaction.user.tag}\nParticipantes cerrados: ${r.closed_count}`
        );

        await refreshGroupMessage(interaction, groupId);

        return interaction.editReply(
          `🔴 Grupo #${groupId} terminado.`
        );
      }
    }
  } catch (err) {
    console.error(err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ Error interno.');
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
