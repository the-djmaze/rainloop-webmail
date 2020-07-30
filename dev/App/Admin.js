import window from 'window';
import ko from 'ko';
import progressJs from 'progressJs';

import { root } from 'Common/Links';
import { getNotification } from 'Common/Translator';
import { StorageResultType, Notification } from 'Common/Enums';
import { pInt, isNormal } from 'Common/Utils';

import * as Settings from 'Storage/Settings';

import AppStore from 'Stores/Admin/App';
import CapaStore from 'Stores/Admin/Capa';
import DomainStore from 'Stores/Admin/Domain';
import PluginStore from 'Stores/Admin/Plugin';
import LicenseStore from 'Stores/Admin/License';
import PackageStore from 'Stores/Admin/Package';
import CoreStore from 'Stores/Admin/Core';
import Remote from 'Remote/Admin/Ajax';

import { SettingsAdminScreen } from 'Screen/Admin/Settings';
import { LoginAdminScreen } from 'Screen/Admin/Login';

import { hideLoading, routeOff, setHash, startScreens } from 'Knoin/Knoin';
import { AbstractApp } from 'App/Abstract';

class AdminApp extends AbstractApp {
	constructor() {
		super(Remote);
	}

	remote() {
		return Remote;
	}

	reloadDomainList() {
		DomainStore.domains.loading(true);
		Remote.domainList((result, data) => {
			DomainStore.domains.loading(false);
			if (StorageResultType.Success === result && data && data.Result) {
				DomainStore.domains(
					Object.entries(data.Result).map(([name, [enabled, alias]]) => ({
						name: name,
						disabled: ko.observable(!enabled),
						alias: alias,
						deleteAccess: ko.observable(false)
					}))
				);
			}
		});
	}

	reloadPluginList() {
		PluginStore.plugins.loading(true);
		Remote.pluginList((result, data) => {
			PluginStore.plugins.loading(false);
			if (StorageResultType.Success === result && data && data.Result) {
				PluginStore.plugins(
					data.Result.map(item => ({
						name: item.Name,
						disabled: ko.observable(!item.Enabled),
						configured: ko.observable(!!item.Configured)
					}))
				);
			}
		});
	}

	reloadPackagesList() {
		PackageStore.packages.loading(true);
		PackageStore.packagesReal(true);
		Remote.packagesList((result, data) => {
			PackageStore.packages.loading(false);
			if (StorageResultType.Success === result && data && data.Result) {
				PackageStore.packagesReal(!!data.Result.Real);
				PackageStore.packagesMainUpdatable(!!data.Result.MainUpdatable);

				let list = [];
				const loading = {};

				PackageStore.packages().forEach(item => {
					if (item && item.loading()) {
						loading[item.file] = item;
					}
				});

				if (Array.isArray(data.Result.List)) {
					list = data.Result.List.map(item => {
						if (item) {
							item.loading = ko.observable(loading[item.file] !== undefined);
							return 'core' === item.type && !item.canBeInstalled ? null : item;
						}
						return null;
					}).filter(value => !!value);
				}

				PackageStore.packages(list);
			} else {
				PackageStore.packagesReal(false);
			}
		});
	}

	updateCoreData() {
		CoreStore.coreUpdating(true);
		Remote.updateCoreData((result, data) => {
			CoreStore.coreUpdating(false);
			CoreStore.coreVersion('');
			CoreStore.coreRemoteVersion('');
			CoreStore.coreRemoteRelease('');
			CoreStore.coreVersionCompare(-2);
			if (StorageResultType.Success === result && data && data.Result) {
				CoreStore.coreReal(true);
				window.location.reload();
			} else {
				CoreStore.coreReal(false);
			}
		});
	}

	reloadCoreData() {
		CoreStore.coreChecking(true);
		CoreStore.coreReal(true);
		Remote.coreData((result, data) => {
			CoreStore.coreChecking(false);
			if (StorageResultType.Success === result && data && data.Result) {
				CoreStore.coreReal(!!data.Result.Real);
				CoreStore.coreChannel(data.Result.Channel || 'stable');
				CoreStore.coreType(data.Result.Type || 'stable');
				CoreStore.coreUpdatable(!!data.Result.Updatable);
				CoreStore.coreAccess(!!data.Result.Access);
				CoreStore.coreWarning(!!data.Result.Warning);
				CoreStore.coreVersion(data.Result.Version || '');
				CoreStore.coreRemoteVersion(data.Result.RemoteVersion || '');
				CoreStore.coreRemoteRelease(data.Result.RemoteRelease || '');
				CoreStore.coreVersionCompare(pInt(data.Result.VersionCompare));
			} else {
				CoreStore.coreReal(false);
				CoreStore.coreChannel('stable');
				CoreStore.coreType('stable');
				CoreStore.coreWarning(false);
				CoreStore.coreVersion('');
				CoreStore.coreRemoteVersion('');
				CoreStore.coreRemoteRelease('');
				CoreStore.coreVersionCompare(-2);
			}
		});
	}

	/**
	 * @param {boolean=} force = false
	 */
	reloadLicensing(force = false) {
		LicenseStore.licensingProcess(true);
		LicenseStore.licenseError('');
		Remote.licensing((result, data) => {
			LicenseStore.licensingProcess(false);
			if (StorageResultType.Success === result && data && data.Result && isNormal(data.Result.Expired)) {
				LicenseStore.licenseValid(true);
				LicenseStore.licenseExpired(pInt(data.Result.Expired));
				LicenseStore.licenseError('');
				LicenseStore.licensing(true);
				AppStore.prem(true);
			} else {
				if (
					data &&
					data.ErrorCode &&
					[Notification.LicensingServerIsUnavailable, Notification.LicensingExpired].includes(pInt(data.ErrorCode))
				) {
					LicenseStore.licenseError(getNotification(pInt(data.ErrorCode)));
					LicenseStore.licensing(true);
				} else {
					if (StorageResultType.Abort === result) {
						LicenseStore.licenseError(getNotification(Notification.LicensingServerIsUnavailable));
						LicenseStore.licensing(true);
					} else {
						LicenseStore.licensing(false);
					}
				}
			}
		}, force);
	}

	bootend(bootendCallback = null) {
		if (progressJs) {
			progressJs.end();
		}

		if (bootendCallback) {
			bootendCallback();
		}
	}

	bootstart() {
		super.bootstart();

		AppStore.populate();
		CapaStore.populate();

		hideLoading();

		if (!Settings.appSettingsGet('allowAdminPanel')) {
			routeOff();
			setHash(root(), true);
			routeOff();

			setTimeout(() =>
				window.location.href = '/'
			, 1);
		} else {
			if (Settings.settingsGet('Auth')) {
				startScreens([SettingsAdminScreen]);
			} else {
				startScreens([LoginAdminScreen]);
			}
		}

		this.bootend();
	}
}

export default new AdminApp();
