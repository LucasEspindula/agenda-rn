import LegalPage from "@/components/legal-page";
import { LEGAL, LEGAL_TERMS } from "@/lib/legal";

export const metadata = { title: "Contrato de tratamento de dados — RN Integra" };

// Acordo de tratamento de dados (controlador × operador), parte integrante dos Termos de uso.
export default function DataProcessingAgreementPage() {
  return <LegalPage current="/contrato-operador" title="Contrato de tratamento de dados"
    intro={`Este contrato integra os Termos de uso e se aplica a toda organização contratante (“Controladora”) que usa o RN Integra, fornecido por ${LEGAL.provider}, CNPJ ${LEGAL.cnpj}, com sede em ${LEGAL.address} (“Operadora”). Ele regula o tratamento, pela Operadora, dos dados pessoais que a Controladora registra no sistema, nos termos dos arts. 37 a 40 da Lei nº 13.709/2018 (LGPD).`}
    sections={[
      ["1. Objeto e instruções", [
        "A Operadora trata os dados pessoais da Controladora exclusivamente para prestar o serviço contratado (agenda, cadastro de pacientes, equipe, documentos e funções relacionadas) e segundo as instruções da Controladora, que se consideram dadas pelo próprio uso das funcionalidades do sistema e por solicitações formais ao canal de contato.",
        "Se uma instrução da Controladora parecer contrária à LGPD, a Operadora a informará e poderá deixar de cumpri-la até que seja esclarecida.",
      ]],
      ["2. Dados e titulares envolvidos", [
        "Titulares: pacientes da Controladora, seus responsáveis legais e os profissionais e colaboradores cadastrados por ela.",
        "Categorias: dados de identificação e contato, CPF, convênio, endereço, dados de agendamento e de atendimento, observações e documentos anexados, incluindo dados pessoais sensíveis referentes à saúde.",
        "Duração: enquanto vigorar a contratação, mais os prazos de devolução e eliminação da cláusula 8.",
      ]],
      ["3. Obrigações da Controladora", [
        "Ter base legal para o tratamento, inclusive para dados de saúde, e informar os titulares; registrar dados exatos e necessários; conceder acessos apenas a quem precisa e removê-los quando a pessoa deixar a equipe; atender os titulares e a ANPD como controladora.",
      ]],
      ["4. Confidencialidade e pessoal", [
        "A Operadora garante que as pessoas autorizadas a tratar os dados estão sujeitas a dever de sigilo e só acessam dados de produção quando necessário para suporte, segurança ou cumprimento legal.",
      ]],
      ["5. Medidas de segurança", [
        "A Operadora mantém, no mínimo: criptografia em trânsito (HTTPS); senhas armazenadas apenas por derivação criptográfica forte; sessões com expiração; isolamento dos dados de cada organização no banco de dados, sem acesso direto pelo navegador; controle de acesso por papel e por agenda; registros de auditoria das alterações e de eventos de segurança; limites de tentativas de acesso; cópias de segurança periódicas; e atualização dos componentes do sistema.",
        "A Operadora pode substituir essas medidas por outras equivalentes ou mais protetivas, sem reduzir o nível de segurança.",
      ]],
      ["6. Suboperadores", [
        "A Controladora autoriza a Operadora a contratar os seguintes suboperadores: Supabase (banco de dados e armazenamento de arquivos, região de São Paulo, Brasil); Vercel (hospedagem da aplicação, processamento em São Paulo, Brasil, e rede de entrega global); Resend (envio de e-mails transacionais, como convites e redefinição de senha).",
        "A Operadora impõe aos suboperadores obrigações de proteção de dados equivalentes às deste contrato e responde por eles perante a Controladora. Novos suboperadores serão informados com pelo menos 15 dias de antecedência; a Controladora poderá se opor por motivo fundamentado e, não havendo solução, cancelar sem multa.",
      ]],
      ["7. Transferência internacional", [
        "Os suboperadores são empresas sediadas nos Estados Unidos. Os dados ficam armazenados no Brasil, mas pode haver acesso ou processamento no exterior para operação, suporte e segurança desses serviços. Nesses casos, a transferência observa o art. 33 da LGPD e a regulamentação da ANPD, mediante cláusulas contratuais de proteção de dados ou outro mecanismo válido.",
      ]],
      ["8. Fim do contrato: devolução e eliminação", [
        `Após o cancelamento, a Controladora tem ${LEGAL_TERMS.exportWindowDays} dias para solicitar a exportação dos seus dados em formato estruturado. Encerrado esse prazo, a Operadora elimina os dados de forma definitiva em até ${LEGAL_TERMS.deletionWithinDays} dias, inclusive das cópias de segurança, e confirma a eliminação por escrito quando solicitado, ressalvada a guarda exigida por lei.`,
      ]],
      ["9. Incidentes de segurança", [
        `A Operadora comunicará à Controladora, em até ${LEGAL_TERMS.incidentNoticeHours} horas após tomar conhecimento, qualquer incidente de segurança que envolva os dados dela, informando, na medida do disponível: natureza do incidente, dados e titulares afetados, medidas adotadas e recomendadas, e contato para acompanhamento. A Operadora apoiará a Controladora na comunicação à ANPD e aos titulares, que é responsabilidade da Controladora.`,
      ]],
      ["10. Apoio aos direitos dos titulares e à Controladora", [
        "O sistema permite à Controladora exportar todos os dados de um paciente e anonimizá-lo. A Operadora apoiará a Controladora, quando necessário, no atendimento a titulares, em relatórios de impacto à proteção de dados e em pedidos da ANPD. Pedidos de titulares recebidos diretamente pela Operadora serão encaminhados à Controladora sem demora.",
      ]],
      ["11. Registros e fiscalização", [
        "A Operadora mantém registro das operações de tratamento que realiza e fornecerá à Controladora, mediante pedido razoável e com aviso prévio, as informações necessárias para demonstrar o cumprimento deste contrato, preservando a segurança e a confidencialidade dos dados de outras organizações.",
      ]],
      ["12. Responsabilidade e vigência", [
        "Cada parte responde pelos danos que causar por descumprimento da LGPD ou deste contrato, nos termos dos arts. 42 a 45 da LGPD. Este contrato vigora enquanto durar a contratação do RN Integra e, quanto às obrigações de sigilo e eliminação, até seu cumprimento integral.",
        `Encarregado da Operadora: ${LEGAL.dpoName} — ${LEGAL.dpoEmail}. Contato geral: ${LEGAL.contactEmail}.`,
      ]],
    ]} />;
}
