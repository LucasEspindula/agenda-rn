import LegalPage from "@/components/legal-page";

export const metadata = { title: "Termos de uso — RN Integra" };

export default function TermsPage() {
  return <LegalPage title="Termos de uso" sections={[
    ["1. O serviço", ["O RN Integra é um sistema on-line de gestão de agendas médicas, contratado por empresas de gestão, clínicas e médicos (a “organização contratante”). O acesso é feito por contas individuais criadas pela organização."]],
    ["2. Conta e responsabilidades", ["O titular da conta responde pelas pessoas que convida e pelos acessos que concede. Cada pessoa deve manter sua senha em sigilo e avisar imediatamente em caso de uso indevido.", "A organização contratante é responsável pela veracidade e pela base legal dos dados de pacientes que registra no sistema."]],
    ["3. Dados de pacientes", ["Os dados de pacientes pertencem à organização contratante, que atua como controladora nos termos da LGPD. O RN Integra trata esses dados como operador, apenas para prestar o serviço, conforme a Política de Privacidade e o contrato de tratamento de dados."]],
    ["4. Uso permitido", ["É proibido usar o sistema para fins ilícitos, tentar acessar dados de outras organizações, contornar controles de segurança ou sobrecarregar o serviço."]],
    ["5. Disponibilidade e suporte", ["Buscamos manter o serviço disponível e seguro, com cópias de segurança e monitoramento. Manutenções programadas serão avisadas com antecedência sempre que possível."]],
    ["6. Planos, cobrança e cancelamento", ["As condições comerciais (plano, valores, período de teste e cancelamento) são as informadas na contratação. Ao cancelar, a organização pode solicitar a exportação dos seus dados dentro do prazo informado."]],
    ["7. Alterações", ["Estes termos podem ser atualizados. Mudanças relevantes serão comunicadas e poderão exigir novo aceite."]],
    ["8. Contato e foro", ["Dúvidas: canal de contato informado na contratação. Fica eleito o foro da comarca da sede do RN Integra, salvo disposição legal em contrário."]],
  ]} />;
}
