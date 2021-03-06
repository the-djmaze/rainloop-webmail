<?php

/*
 * This file is part of MailSo.
 *
 * (c) 2014 Usenko Timur
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace MailSo\Log\Drivers;

/**
 * @category MailSo
 * @package Log
 * @subpackage Drivers
 */
class Inline extends \MailSo\Log\Driver
{
	/**
	 * @var bool
	 */
	private $bHtmlEncodeSpecialChars;

	function __construct(string $sNewLine = "\r\n", bool $bHtmlEncodeSpecialChars = false)
	{
		parent::__construct();

		$this->sNewLine = $sNewLine;
		$this->bHtmlEncodeSpecialChars = $bHtmlEncodeSpecialChars;
	}

	protected function writeImplementation($mDesc) : bool
	{
		if (\is_array($mDesc))
		{
			if ($this->bHtmlEncodeSpecialChars)
			{
				$mDesc = \array_map(function ($sItem) {
					return \htmlspecialchars($sItem);
				}, $mDesc);
			}

			$mDesc = \implode($this->sNewLine, $mDesc);
		}
		else
		{
			echo ($this->bHtmlEncodeSpecialChars) ? \htmlspecialchars($mDesc).$this->sNewLine : $mDesc.$this->sNewLine;
		}

		return true;
	}

	protected function clearImplementation() : bool
	{
		if (\defined('PHP_SAPI') && 'cli' === PHP_SAPI && \MailSo\Base\Utils::FunctionExistsAndEnabled('system'))
		{
			\system('clear');
		}

		return true;
	}
}
