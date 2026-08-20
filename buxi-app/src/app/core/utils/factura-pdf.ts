import jsPDF from 'jspdf';
import { Factura } from '../models/features.model';

// No es una factura electrónica timbrada ante Hacienda (eso exige
// inscripción, firma digital y XML) — es un comprobante descargable de la
// suscripción al plan, generado en el navegador sin backend.
export function descargarFacturaPDF(factura: Factura): void {
  const doc = new jsPDF();
  const empresaNombre = factura.empresa?.nombre || '';
  const cedula = factura.empresa?.cedula_juridica || 'N/D';
  const planNombre = factura.plan?.nombre || '';
  // "₡" no existe en la codificación estándar (WinAnsi) que usa la fuente
  // por defecto de jsPDF -- se veía como un signo de exclamación invertido
  // en el PDF real, no solo en teoría (confirmado abriendo el archivo
  // generado). "CRC" es el código ISO 4217, siempre se ve bien.
  const montoTexto = `CRC ${Number(factura.monto).toLocaleString('es-CR')}`;

  doc.setFontSize(20);
  doc.setTextColor(0, 200, 83);
  doc.text('Buxi', 20, 22);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Comprobante de suscripción', 20, 29);

  doc.setDrawColor(220);
  doc.line(20, 34, 190, 34);

  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text('FACTURA', 20, 46);
  doc.setFontSize(10);
  doc.text(`N.° ${factura.numero}`, 20, 53);
  doc.text(`Fecha: ${factura.fecha}`, 20, 59);

  doc.setFontSize(11);
  doc.text('Facturado a:', 20, 72);
  doc.setFontSize(10);
  doc.text(empresaNombre, 20, 79);
  doc.text(`Cédula jurídica: ${cedula}`, 20, 85);

  doc.setFillColor(245, 247, 250);
  doc.rect(20, 96, 170, 10, 'F');
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text('Concepto', 24, 103);
  doc.text('Monto', 186, 103, { align: 'right' });

  doc.setTextColor(20);
  doc.text(`Plan ${planNombre} (mensual)`, 24, 116);
  doc.text(montoTexto, 186, 116, { align: 'right' });

  doc.setDrawColor(220);
  doc.line(20, 122, 190, 122);

  doc.setFontSize(12);
  doc.text('Total', 150, 132);
  doc.text(montoTexto, 186, 132, { align: 'right' });

  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('Este comprobante no constituye una factura electrónica timbrada ante el Ministerio de Hacienda.', 20, 280);

  doc.save(`${factura.numero}.pdf`);
}
