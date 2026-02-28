// bot.js - Versión Docker (sin Express)
require('dotenv').config();
const Discord = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configuración desde variables de entorno
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  logsChannelId: process.env.LOGS_CHANNEL_ID,
  bonusChannelId: process.env.BONUS_CHANNEL_ID,
  bonusPercentage: parseInt(process.env.BONUS_PERCENTAGE) || 10,
  timezone: process.env.TIMEZONE || 'America/Argentina/Buenos_Aires'
};

// Validar configuración
if (!CONFIG.token || !CONFIG.logsChannelId || !CONFIG.bonusChannelId) {
  console.error('❌ ERROR: Faltan variables de entorno requeridas');
  console.error('TOKEN:', CONFIG.token ? 'OK' : 'FALTA');
  console.error('LOGS_CHANNEL_ID:', CONFIG.logsChannelId ? 'OK' : 'FALTA');
  console.error('BONUS_CHANNEL_ID:', CONFIG.bonusChannelId ? 'OK' : 'FALTA');
  process.exit(1);
}

const client = new Discord.Client({
  intents: [
    Discord.GatewayIntentBits.Guilds,
    Discord.GatewayIntentBits.GuildMessages,
    Discord.GatewayIntentBits.MessageContent
  ]
});

// Base de datos
let employees = {};
let weekStartDate = new Date();

const DATA_FILE = path.join(__dirname, 'employees_data.json');

// Cargar datos
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      employees = data.employees || {};
      weekStartDate = new Date(data.weekStartDate) || new Date();
      console.log(`✅ Datos cargados: ${Object.keys(employees).length} empleados`);
    }
  } catch (error) {
    console.error('Error al cargar datos:', error);
  }
}

// Guardar datos
function saveData() {
  try {
    const data = {
      employees,
      weekStartDate: weekStartDate.toISOString(),
      lastUpdate: new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error al guardar datos:', error);
  }
}

// Limpiar texto de formato Discord
function cleanText(text) {
  return text.replace(/\*\*/g, '')
             .replace(/`/g, '')
             .replace(/\*/g, '')
             .replace(/_/g, '')
             .replace(/~/g, '')
             .trim();
}

// Extraer DNI (acepta 8 caracteres alfanuméricos)
function extractDNI(text) {
  const cleanedText = cleanText(text);
  const match = cleanedText.match(/\[\s*([A-Z0-9]{8})\s*\]/i);
  if (match) {
    return match[1].replace(/\s/g, '').toUpperCase();
  }
  return null;
}

// Extraer nombre
function extractName(text) {
  const cleanedText = cleanText(text);
  const match = cleanedText.match(/\[\s*[A-Z0-9]{8}\s*\]\s+([^h]+?)(?:\s+ha\s+(?:retirado|guardado|enviado))/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

// Extraer monto
function extractAmount(text) {
  const cleanedText = cleanText(text);
  const match = cleanedText.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''));
  }
  return 0;
}

// Procesar log
function processLog(message) {
  const content = message.content;
  const cleanedContent = cleanText(content);
  
  // Buscar factura pagada
  if (cleanedContent.toLowerCase().includes('ha pagado una factura') && 
      cleanedContent.toLowerCase().includes('de [')) {
    
    const dni = extractDNI(content);
    const amount = extractAmount(content);
    
    if (dni && amount > 0) {
      if (!employees[dni]) {
        employees[dni] = { name: dni, sales: [] };
      }
      
      const alreadyProcessed = employees[dni].sales.some(sale => sale.messageId === message.id);
      if (alreadyProcessed) {
        console.log(`⚠️ Venta duplicada ignorada: ${dni} - $${amount}`);
        return false;
      }
      
      employees[dni].sales.push({
        amount: amount,
        date: message.createdAt.toISOString(),
        messageId: message.id
      });
      
      const totalSales = employees[dni].sales.reduce((sum, s) => sum + s.amount, 0);
      console.log(`💰 Venta: ${dni} +$${amount} (Total: $${totalSales})`);
      
      saveData();
      return true;
    }
  }
  
  // Buscar nombre de empleado
  if (cleanedContent.toLowerCase().includes('ha retirado') || 
      cleanedContent.toLowerCase().includes('ha guardado') || 
      cleanedContent.toLowerCase().includes('ha enviado')) {
    
    const dni = extractDNI(content);
    const name = extractName(content);
    
    if (dni && name) {
      if (!employees[dni]) {
        employees[dni] = { name: name, sales: [] };
      } else {
        employees[dni].name = name;
      }
      saveData();
      return false;
    }
  }
  
  return false;
}

// Calcular totales
function calculateTotals() {
  const results = [];
  
  for (const [dni, data] of Object.entries(employees)) {
    const totalSales = data.sales.reduce((sum, sale) => sum + sale.amount, 0);
    const bonus = Math.round(totalSales * (CONFIG.bonusPercentage / 100));
    
    results.push({
      dni,
      name: data.name,
      salesCount: data.sales.length,
      totalSales,
      bonus
    });
  }
  
  return results.sort((a, b) => b.totalSales - a.totalSales);
}

// Generar reporte
function generateReport() {
  const results = calculateTotals();
  const totalSales = results.reduce((sum, emp) => sum + emp.totalSales, 0);
  const totalBonuses = results.reduce((sum, emp) => sum + emp.bonus, 0);
  
  const embed = new Discord.EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('📊 REPORTE SEMANAL DE BONOS')
    .setDescription(`**Período:** ${weekStartDate.toLocaleDateString('es-AR')} - ${new Date().toLocaleDateString('es-AR')}`)
    .addFields(
      { name: '💵 Total Ventas', value: `$${totalSales.toLocaleString('es-AR')}`, inline: true },
      { name: '🎁 Total Bonos', value: `$${totalBonuses.toLocaleString('es-AR')}`, inline: true },
      { name: '📈 Porcentaje', value: `${CONFIG.bonusPercentage}%`, inline: true }
    )
    .setTimestamp();
  
  if (results.length === 0) {
    embed.addFields({ name: '❌ Sin datos', value: 'No hay ventas registradas esta semana.' });
    return embed;
  }
  
  const top = results[0];
  embed.addFields({
    name: '🏆 EMPLEADO DESTACADO',
    value: `**${top.name}** (${top.dni})\n${top.salesCount} venta(s) | Total: $${top.totalSales.toLocaleString('es-AR')} | Bono: $${top.bonus.toLocaleString('es-AR')}`,
    inline: false
  });
  
  let list = '';
  results.forEach((emp, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▫️';
    list += `${medal} **${emp.name}** (${emp.dni})\n`;
    list += `   └ ${emp.salesCount} venta(s) → $${emp.totalSales.toLocaleString('es-AR')} → Bono: $${emp.bonus.toLocaleString('es-AR')}\n\n`;
  });
  
  embed.addFields({ name: '👥 Detalle por Empleado', value: list || 'Sin datos' });
  
  return embed;
}

function resetWeek() {
  employees = {};
  weekStartDate = new Date();
  saveData();
  console.log('🔄 Semana reseteada');
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  if (message.channel.id === CONFIG.logsChannelId) {
    processLog(message);
    return;
  }
  
  if (message.channel.id !== CONFIG.bonusChannelId) return;
  if (!message.content.startsWith('!')) return;
  
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();
  
// Comandos
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Procesar logs automáticamente
  if (message.channel.id === CONFIG.logsChannelId) {
    processLog(message);
    return;
  }
  
  // Comandos en canal de bonos
  if (message.channel.id !== CONFIG.bonusChannelId) return;
  if (!message.content.startsWith('!')) return;
  
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();
  
  // !test
  if (command === 'test' || command === 'ping') {
    const logsChannel = client.channels.cache.get(CONFIG.logsChannelId);
    const bonusChannel = client.channels.cache.get(CONFIG.bonusChannelId);
    
    const embed = new Discord.EmbedBuilder()
      .setColor('#00D9FF')
      .setTitle('🔍 Estado del Bot')
      .addFields(
        { name: '✅ Estado', value: 'Online', inline: true },
        { name: '📺 Logs', value: logsChannel ? `#${logsChannel.name}` : '❌', inline: true },
        { name: '💰 Bonos', value: bonusChannel ? `#${bonusChannel.name}` : '❌', inline: true },
        { name: '📊 Porcentaje', value: `${CONFIG.bonusPercentage}%`, inline: true },
        { name: '👥 Empleados', value: `${Object.keys(employees).length}`, inline: true },
        { name: '📅 Semana', value: weekStartDate.toLocaleDateString('es-AR'), inline: true }
      );
    
    await message.reply({ embeds: [embed] });
  }
  
  // !testlog
  if (command === 'testlog') {
    const testText = args.slice(1).join(' ');
    if (!testText) {
      return message.reply('❌ Uso: `!testlog [mensaje]`');
    }
    
    const mockMessage = {
      content: testText,
      createdAt: new Date(),
      id: 'test-' + Date.now()
    };
    
    await message.reply(`🧪 Probando:\n\`\`\`${testText}\`\`\``);
    
    const result = processLog(mockMessage);
    
    if (result) {
      await message.channel.send('✅ Venta registrada! Usa `!reporte` para ver.');
    } else {
      await message.channel.send('❌ No se procesó como venta. Verifica el formato.');
    }
  }
  
  // !reporte
  if (command === 'reporte') {
    const embed = generateReport();
    await message.reply({ embeds: [embed] });
  }
  
  // !empleados
  if (command === 'empleados') {
    if (Object.keys(employees).length === 0) {
      return message.reply('❌ No hay empleados registrados.');
    }
    
    const results = calculateTotals();
    
    const embed = new Discord.EmbedBuilder()
      .setColor('#00D9FF')
      .setTitle('👥 LISTA DE EMPLEADOS')
      .setDescription(`Total: ${results.length} empleado(s)`)
      .setTimestamp();
    
    let list = '';
    results.forEach((emp) => {
      const icon = emp.totalSales > 0 ? '✅' : '⚪';
      list += `${icon} **${emp.name}** (${emp.dni})\n`;
      list += `   └ ${emp.salesCount} venta(s) | $${emp.totalSales.toLocaleString('es-AR')} | Bono: $${emp.bonus.toLocaleString('es-AR')}\n\n`;
    });
    
    if (list.length > 1024) {
      const chunks = list.match(/[\s\S]{1,1024}/g) || [];
      chunks.forEach((chunk, i) => {
        embed.addFields({
          name: i === 0 ? '📋 Empleados' : '​',
          value: chunk,
          inline: false
        });
      });
    } else {
      embed.addFields({
        name: '📋 Empleados',
        value: list,
        inline: false
      });
    }
    
    await message.reply({ embeds: [embed] });
  }
  
  // !empleado
  if (command === 'empleado') {
    const dni = args[1]?.toUpperCase();
    
    if (!dni) {
      return message.reply('❌ Uso: `!empleado <DNI>`\nEjemplo: `!empleado OA1EU67B`');
    }
    
    const employee = employees[dni];
    
    if (!employee) {
      return message.reply(`❌ No se encontró al empleado con DNI: ${dni}`);
    }
    
    const totalSales = employee.sales.reduce((sum, s) => sum + s.amount, 0);
    const bonus = Math.round(totalSales * (CONFIG.bonusPercentage / 100));
    
    const embed = new Discord.EmbedBuilder()
      .setColor('#FFD700')
      .setTitle(`👤 ${employee.name}`)
      .setDescription(`**DNI:** ${dni}`)
      .addFields(
        { name: '💰 Total Ventas', value: `$${totalSales.toLocaleString('es-AR')}`, inline: true },
        { name: '🎁 Bono', value: `$${bonus.toLocaleString('es-AR')}`, inline: true },
        { name: '📊 Cantidad', value: `${employee.sales.length} venta(s)`, inline: true }
      )
      .setTimestamp();
    
    if (employee.sales.length > 0) {
      let salesList = '';
      const recentSales = employee.sales.slice(-10).reverse();
      
      recentSales.forEach(sale => {
        const date = new Date(sale.date);
        salesList += `• $${sale.amount} - ${date.toLocaleDateString('es-AR')} ${date.toLocaleTimeString('es-AR', {hour: '2-digit', minute: '2-digit'})}\n`;
      });
      
      embed.addFields({
        name: `📝 Últimas ${recentSales.length} ventas`,
        value: salesList,
        inline: false
      });
    }
    
    await message.reply({ embeds: [embed] });
  }
  
  // !leer
  if (command === 'leer') {
    if (!message.member.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo administradores.');
    }

    const subCmd = args[1];
    const value = args[2];

    if (!subCmd || !value) {
      return message.reply('❌ Uso: `!leer fecha DD/MM/YYYY` o `!leer cantidad 100`');
    }

    const logsChannel = client.channels.cache.get(CONFIG.logsChannelId);
    if (!logsChannel) {
      return message.reply('❌ Canal de logs no encontrado.');
    }

    await message.reply('⏳ Leyendo logs...');

    try {
      let messagesToProcess = [];
      let startDate = null;
      let limit = null;

      if (subCmd === 'fecha') {
        const [day, month, year] = value.split('/').map(Number);
        if (!day || !month || !year) {
          return message.channel.send('❌ Formato: DD/MM/YYYY');
        }
        startDate = new Date(year, month - 1, day, 0, 0, 0);
      } else if (subCmd === 'cantidad') {
        limit = parseInt(value);
        if (isNaN(limit) || limit < 1 || limit > 1000) {
          return message.channel.send('❌ Cantidad entre 1 y 1000.');
        }
      } else {
        return message.channel.send('❌ Usa: `fecha` o `cantidad`');
      }

      let lastId;
      let totalFetched = 0;
      let processed = 0;

      while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const msgs = await logsChannel.messages.fetch(options);
        if (msgs.size === 0) break;

        for (const msg of msgs.values()) {
          if (startDate && msg.createdAt < startDate) continue;
          
          messagesToProcess.push(msg);
          totalFetched++;

          if (limit && totalFetched >= limit) break;
        }

        if (limit && totalFetched >= limit) break;
        if (msgs.size < 100) break;

        lastId = msgs.last().id;
      }

      messagesToProcess.reverse();
      
      console.log(`📚 Procesando ${messagesToProcess.length} mensajes...`);
      
      for (const msg of messagesToProcess) {
        if (processLog(msg)) {
          processed++;
        }
      }

      const embed = new Discord.EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Logs Procesados')
        .addFields(
          { name: '📥 Leídos', value: `${totalFetched}`, inline: true },
          { name: '💰 Ventas', value: `${processed}`, inline: true },
          { name: '👥 Empleados', value: `${Object.keys(employees).length}`, inline: true }
        );

      await message.channel.send({ embeds: [embed] });
      
      if (processed > 0) {
        const total = Object.values(employees).reduce((sum, emp) => 
          sum + emp.sales.reduce((s, sale) => s + sale.amount, 0), 0
        );
        await message.channel.send(`📊 Total acumulado: $${total.toLocaleString('es-AR')}`);
      }

    } catch (error) {
      console.error('Error:', error);
      await message.channel.send('❌ Error al procesar logs.');
    }
  }
  
  // !cerrar
  if (command === 'cerrar') {
    if (!message.member.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo administradores.');
    }
    
    const embed = generateReport();
    await message.reply({ embeds: [embed] });
    await message.channel.send('✅ Semana cerrada. Datos reseteados.');
    
    resetWeek();
  }
  
  // !resetdata
  if (command === 'resetdata') {
    if (!message.member.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo administradores.');
    }
    
    await message.reply('⚠️ **ADVERTENCIA:** Esto borrará TODOS los datos.\nEscribe `!confirmar` en 30 segundos.');
    
    const filter = m => m.author.id === message.author.id && m.content === '!confirmar';
    
    try {
      await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      
      const oldCount = Object.keys(employees).length;
      employees = {};
      weekStartDate = new Date();
      saveData();
      
      await message.channel.send(`✅ Datos eliminados. ${oldCount} empleado(s) borrados.`);
    } catch {
      await message.channel.send('❌ Cancelado.');
    }
  }
  
  // !porcentaje
  if (command === 'porcentaje') {
    if (!message.member.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo administradores.');
    }
    
    const newPct = parseInt(args[1]);
    if (isNaN(newPct) || newPct < 0 || newPct > 100) {
      return message.reply('❌ Número entre 0 y 100.');
    }
    
    CONFIG.bonusPercentage = newPct;
    await message.reply(`✅ Porcentaje: **${newPct}%**`);
  }
  
  // !ayuda
  if (command === 'ayuda' || command === 'help') {
    const embed = new Discord.EmbedBuilder()
      .setColor('#00D9FF')
      .setTitle('📋 Comandos del Bot de Bonos')
      .setDescription('Sistema de cálculo de bonos semanales')
      .addFields(
        { name: '📊 Consultas', value: '`!test` - Estado\n`!reporte` - Reporte semanal\n`!empleados` - Lista\n`!empleado <DNI>` - Detalle', inline: false },
        { name: '🔧 Pruebas', value: '`!testlog <texto>` - Probar log', inline: false },
        { name: '🔒 Admin', value: '`!leer fecha DD/MM/YYYY`\n`!leer cantidad N`\n`!cerrar` - Cerrar semana\n`!porcentaje N`\n`!resetdata`', inline: false }
      )
      .setFooter({ text: `Bono: ${CONFIG.bonusPercentage}% | Semana: Lun-Dom` });
    
    await message.reply({ embeds: [embed] });
  }
});

});

function scheduleWeeklyClose() {
  setInterval(() => {
    const now = new Date();
    const argTime = new Date(now.toLocaleString('en-US', { timeZone: CONFIG.timezone }));
    
    if (argTime.getDay() === 0 && argTime.getHours() === 23 && argTime.getMinutes() === 0) {
      console.log('⏰ Cierre automático');
      
      const channel = client.channels.cache.get(CONFIG.bonusChannelId);
      if (channel) {
        const embed = generateReport();
        channel.send({ embeds: [embed] });
        channel.send('✅ Semana cerrada automáticamente.');
        resetWeek();
      }
    }
  }, 60000);
}

client.once(Discord.Events.ClientReady, async () => {
  console.log(`✅ Bot: ${client.user.tag}`);
  
  const logsChannel = client.channels.cache.get(CONFIG.logsChannelId);
  const bonusChannel = client.channels.cache.get(CONFIG.bonusChannelId);
  
  console.log(`📺 Logs: ${logsChannel ? `#${logsChannel.name}` : '❌'}`);
  console.log(`💰 Bonos: ${bonusChannel ? `#${bonusChannel.name}` : '❌'}`);
  console.log(`📊 Bono: ${CONFIG.bonusPercentage}%`);
  
  loadData();
  scheduleWeeklyClose();
  
  if (bonusChannel) {
    const embed = new Discord.EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🤖 Bot Online')
      .setDescription('Monitoreando logs y calculando bonos')
      .addFields(
        { name: '📺 Logs', value: logsChannel ? `<#${CONFIG.logsChannelId}>` : '❌', inline: true },
        { name: '📊 Bono', value: `${CONFIG.bonusPercentage}%`, inline: true },
        { name: '⏰ Cierre', value: 'Dom 23:00', inline: true }
      )
      .setFooter({ text: 'Usa !ayuda' });
    
    await bonusChannel.send({ embeds: [embed] });
  }
});

client.on('error', error => {
  console.error('❌ Error del cliente Discord:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Error no manejado:', error);
});

// Manejo de señales para cierre graceful
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recibido, cerrando bot...');
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recibido, cerrando bot...');
  client.destroy();
  process.exit(0);
});

console.log('🔌 Conectando a Discord...');
client.login(CONFIG.token).catch(error => {
  console.error('❌ Error al conectar con Discord:', error);
  process.exit(1);
});