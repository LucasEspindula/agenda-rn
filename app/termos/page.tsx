import LegalPage from "@/components/legal-page";
import { LEGAL, LEGAL_TERMS } from "@/lib/legal";

export const metadata = { title: "Termos de uso — RN Integra" };

export default function TermsPage() {
  return <LegalPage current="/termos" title="Termos de uso"
    intro={`Estes termos regem o uso do RN Integra, fornecido por ${LEGAL.provider}, inscrita no CNPJ ${LEGAL.cnpj}, com sede em ${LEGAL.address} (“RN Integra”, “nós”). Ao criar uma conta, aceitar um convite ou usar o sistema, você concorda com estes termos, com a Política de privacidade e, quando contratar em nome de uma organização, com o Contrato de tratamento de dados.`}
    sections={[
      ["1. O serviço", [
        "O RN Integra é um sistema on-line para gestão de agendas médicas: agendamentos, cadastro de pacientes, regras e bloqueios de agenda, equipe e permissões. É contratado por empresas de gestão, clínicas e médicos autônomos (a “organização contratante”).",
        "O sistema é uma ferramenta de organização administrativa. Não é prontuário eletrônico, não faz diagnóstico nem substitui o julgamento clínico, e não envia informações a convênios, hospitais ou órgãos públicos em nome da organização.",
      ]],
      ["2. Contas, organizações e acessos", [
        "A pessoa que cria a conta é o titular da conta e representa a organização contratante. Ela pode criar organizações dentro do limite do plano e convidar pessoas como gerente, secretária(o) ou médico(a).",
        "O acesso é pessoal e intransferível. Cada pessoa deve manter a senha em sigilo, usar uma senha forte e avisar imediatamente o gerente da organização e o RN Integra em caso de suspeita de uso indevido.",
        "A organização contratante responde pelos acessos que concede, pelas agendas que libera a cada pessoa e por remover o acesso de quem deixar a equipe. Por segurança, o titular da conta não pode ser removido e ninguém pode remover o próprio acesso.",
      ]],
      ["3. Dados de pacientes", [
        "Os dados de pacientes e da agenda pertencem à organização contratante, que é a controladora desses dados nos termos da Lei nº 13.709/2018 (LGPD). O RN Integra atua como operador: trata esses dados somente para prestar o serviço e conforme as instruções da organização, nos termos do Contrato de tratamento de dados.",
        "A organização contratante é responsável pela exatidão dos dados que registra, por informar os pacientes sobre o tratamento e por ter base legal adequada, inclusive para dados de saúde.",
      ]],
      ["4. Uso permitido", [
        "É proibido: usar o sistema para fins ilícitos ou para enviar conteúdo ofensivo; tentar acessar dados de outras organizações ou de agendas não liberadas; contornar controles de segurança, testar vulnerabilidades sem autorização escrita; automatizar acessos em volume que prejudique o serviço; revender ou sublicenciar o acesso.",
        "Em caso de violação, podemos suspender o acesso envolvido para proteger o serviço e os dados, comunicando a organização contratante.",
      ]],
      ["5. Disponibilidade, segurança e suporte", [
        "Empregamos medidas técnicas e administrativas para manter o serviço disponível e os dados protegidos, descritas na Política de privacidade e no Contrato de tratamento de dados. O serviço pode passar por manutenções; as programadas serão avisadas com antecedência sempre que possível.",
        `Suporte e comunicações: ${LEGAL.contactEmail}.`,
      ]],
      ["6. Planos, pagamento e cancelamento", [
        "As condições comerciais (plano, limites, valores, período de teste e forma de pagamento) são as informadas na contratação. O não pagamento pode levar à suspensão da conta após aviso.",
        `A organização contratante pode cancelar a qualquer momento. Após o cancelamento, ela tem ${LEGAL_TERMS.exportWindowDays} dias para solicitar a exportação dos seus dados; depois disso, os dados são eliminados de forma definitiva em até ${LEGAL_TERMS.deletionWithinDays} dias, inclusive das cópias de segurança, salvo obrigação legal de guarda.`,
      ]],
      ["7. Propriedade intelectual", [
        "O software, a marca e os materiais do RN Integra pertencem ao fornecedor. A contratação concede à organização um direito de uso não exclusivo, enquanto durar o contrato. Os dados inseridos pela organização continuam sendo dela.",
      ]],
      ["8. Responsabilidades", [
        "Respondemos pelos danos que causarmos ao descumprir estes termos ou a legislação de proteção de dados, nos limites da lei. Não respondemos por decisões clínicas ou administrativas tomadas com base nas informações registradas pela organização, nem por falhas causadas por uso indevido de senhas ou acessos concedidos pela própria organização.",
      ]],
      ["9. Alterações destes termos", [
        "Podemos atualizar estes termos. Mudanças relevantes serão comunicadas com antecedência razoável e poderão exigir novo aceite. A versão vigente fica sempre nesta página.",
      ]],
      ["10. Lei aplicável e foro", [
        `Aplica-se a legislação brasileira. Fica eleito o foro da comarca de ${LEGAL.forum}, ressalvados os casos em que a lei garantir outro foro ao consumidor.`,
      ]],
    ]} />;
}
