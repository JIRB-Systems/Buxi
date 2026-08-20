import jsPDF from 'jspdf';
import { Viaje, ReporteBug } from '../models/features.model';
import { Empresa } from '../models/transport.model';

interface ViajeConRuta extends Viaje {
  ruta?: { nombre: string; precio: number | null };
}

interface ReporteMensualInput {
  empresa: Empresa | null;
  mesLabel: string; // ej. "Agosto 2026"
  viajes: ViajeConRuta[];
  reportes: ReporteBug[];
}

// Resumen mensual armado en el navegador a partir de la actividad ya
// registrada en Buxi (viajes, reportes) -- no hay pasarela de pago real, así
// que "ingresos" es un estimado (viajes × precio de la ruta), no un dato
// financiero real. Se aclara en el propio PDF, igual que con las facturas.
export function descargarReporteMensualPDF(input: ReporteMensualInput): void {
  const { empresa, mesLabel, viajes, reportes } = input;

  const totalViajes = viajes.length;
  const totalKm = viajes.reduce((s, v) => s + (v.distancia_km || 0), 0);
  const ingresosEstimados = viajes.reduce((s, v) => s + (v.ruta?.precio || 0), 0);

  const emergencias = reportes.filter(r => r.titulo === 'Emergencia');
  const emergenciasResueltas = emergencias.filter(r => r.estado === 'resuelto').length;
  const otrosReportes = reportes.length - emergencias.length;

  const empresaNombre = empresa?.nombre || '';
  const cedula = empresa?.cedula_juridica || 'N/D';
  // "₡" no existe en la codificación estándar (WinAnsi) de la fuente por
  // defecto de jsPDF -- se ve como un signo de exclamación invertido en el
  // PDF real. "CRC" es el código ISO 4217, siempre se ve bien.
  const fmtMonto = (n: number) => `CRC ${Math.round(n).toLocaleString('es-CR')}`;

  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.setTextColor(0, 200, 83);
  doc.text('Buxi', 20, 22);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Reporte mensual de operación', 20, 29);

  doc.setDrawColor(220);
  doc.line(20, 34, 190, 34);

  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(mesLabel, 20, 46);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(empresaNombre, 20, 53);
  doc.text(`Cédula jurídica: ${cedula}`, 20, 59);

  // ---- Actividad ----
  doc.setFillColor(245, 247, 250);
  doc.rect(20, 70, 170, 34, 'F');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('ACTIVIDAD', 26, 78);
  doc.setFontSize(20);
  doc.setTextColor(20);
  doc.text(String(totalViajes), 26, 92);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Viajes completados', 26, 98);

  doc.setFontSize(20);
  doc.setTextColor(20);
  doc.text(`${totalKm.toFixed(0)} km`, 110, 92);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Distancia recorrida', 110, 98);

  // ---- Seguridad ----
  doc.setFillColor(245, 247, 250);
  doc.rect(20, 110, 170, 34, 'F');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('SEGURIDAD Y SOPORTE', 26, 118);

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(String(emergencias.length), 26, 132);
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  doc.text('Emergencias reportadas', 26, 138);

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(String(emergenciasResueltas), 90, 132);
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  doc.text('Resueltas', 90, 138);

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(String(otrosReportes), 145, 132);
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  doc.text('Otros reportes', 145, 138);

  // ---- Ingresos estimados ----
  doc.setDrawColor(220);
  doc.line(20, 156, 190, 156);
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text('Ingresos estimados', 20, 168);
  doc.setFontSize(18);
  doc.setTextColor(0, 168, 68);
  doc.text(fmtMonto(ingresosEstimados), 190, 168, { align: 'right' });

  doc.setFontSize(8);
  doc.setTextColor(150);
  const disclaimer = doc.splitTextToSize(
    'Estimado a partir de los viajes completados × el precio de cada ruta. No hay pasarela de pago conectada todavía, así que este monto no proviene de cobros reales.',
    170,
  );
  doc.text(disclaimer, 20, 176);

  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('Generado automáticamente por Buxi a partir de la actividad registrada en la plataforma.', 20, 280);

  doc.save(`reporte-${mesLabel.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}
